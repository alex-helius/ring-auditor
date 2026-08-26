"use client";

import { useWallet, type WalletContextState } from "@solana/wallet-adapter-react";
import { isAddress, type Address } from "@solana/kit";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LocalWalletAuthority,
  SOL_MINT,
  Wallet,
  createZolanaClient,
  syncWallet,
} from "@heliuslabs/zolana";
import { buildRegistrationTransaction, fetchUserRecord } from "@heliuslabs/zolana/wallet";
import {
  ShieldedAddress,
  ShieldedKeypair,
  SigningKey,
  ed25519DerivationPayload,
  type Bytes32,
} from "@heliuslabs/zolana/keypair";
import {
  buildRingDepositTransaction,
  buildRingLookupTableTransaction,
  buildRingTransferTransaction,
  buildRingWithdrawalTransaction,
} from "@heliuslabs/zolana/ring";
import { connectedAddress, sendTransaction, walletAddress } from "./chain";
import { INDEXER_URL, PROVER_URL, SOLANA_RPC_URL, TREE, type Ring } from "./config";
import type { Recipient } from "./address";
import { stored } from "./storage";

type ZolanaClient = Awaited<ReturnType<typeof createZolanaClient>>;

/** The wallet's notes and history as of `slot`, after a full sync. */
export interface Synced {
  readonly wallet: Wallet;
  readonly slot: bigint;
  readonly viewingPublicKey: Uint8Array;
  readonly client: ZolanaClient;
}

/** Derived once per wallet connection, the wallet signs one time. */
export interface Shielded {
  readonly balance: bigint | undefined;
  /** Where transfers to this wallet land, set once the keys are derived. */
  readonly address: ShieldedAddress | undefined;
  sync(): Promise<Synced>;
  refresh(ring: Address): Promise<bigint>;
  deposit(ring: Address, lamports: bigint): Promise<string>;
  transfer(ring: Ring, lamports: bigint, recipient: Recipient): Promise<string>;
  /** Value leaves the ring in the clear, for a recipient with no registry record. */
  withdraw(ring: Ring, lamports: bigint, recipient: Address): Promise<string>;
  /** Whether a Solana address can receive a shielded note. */
  registered(recipient: Address): Promise<boolean>;
  /** True with no registry record, false with one, undefined before the first sync. */
  readonly unregistered: boolean | undefined;
  /** Publishes this wallet's shielded keys so its Solana address is payable. */
  register(): Promise<string>;
  /** A transfer to a key nobody holds. */
  burn(ring: Ring, lamports: bigint): Promise<string>;
}

interface Session {
  readonly wallet: Address;
  readonly authority: LocalWalletAuthority;
  readonly address: ShieldedAddress;
  readonly balance?: bigint;
}

/** Ref state, read before React re-renders. */
interface Derived {
  readonly wallet: Address;
  readonly authority: LocalWalletAuthority;
  shielded?: Wallet;
}

const ShieldedContext = createContext<Shielded | undefined>(undefined);

export function useShielded(): Shielded {
  const value = useContext(ShieldedContext);
  if (!value) throw new Error("useShielded outside ShieldedProvider");
  return value;
}

export function ShieldedProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const address = walletAddress(wallet);
  const [session, setSession] = useState<Session>();
  const [unregistered, setUnregistered] = useState<boolean>();
  const current = session?.wallet === address ? session : undefined;
  const clientRef = useRef<Promise<ZolanaClient>>(undefined);
  const derivedRef = useRef<Derived>(undefined);

  const client = useCallback(() => {
    clientRef.current ??= createZolanaClient({
      solanaRpcUrl: SOLANA_RPC_URL,
      indexerUrl: INDEXER_URL,
      proverUrl: PROVER_URL,
      tree: TREE,
      allowInsecureHttp: true,
    });
    return clientRef.current;
  }, []);

  const derived = useCallback(async (): Promise<Derived> => {
    const owner = connectedAddress(wallet);
    if (derivedRef.current?.wallet === owner) return derivedRef.current;
    const { signMessage } = wallet;
    if (!signMessage) throw new Error("the wallet cannot sign messages");
    // Poseidon must be loaded before derivation.
    await client();
    const authority = LocalWalletAuthority.fromDerivationSeed({
      solanaPublicKey: owner,
      derivationSeed: await signMessage(ed25519DerivationPayload()),
    });
    derivedRef.current = { wallet: owner, authority };
    setSession({ wallet: owner, authority, address: await authority.shieldedAddress() });
    return derivedRef.current;
  }, [client, wallet]);

  const shieldedWallet = useCallback(async () => {
    const d = await derived();
    d.shielded ??= new Wallet({ identity: await d.authority.shieldedAddress() });
    return { authority: d.authority, shielded: d.shielded, owner: d.wallet };
  }, [derived]);

  const sync = useCallback(async (): Promise<Synced> => {
    const { authority, shielded } = await shieldedWallet();
    const c = await client();
    const slot = BigInt(await c.solanaRpc.getSlot().send());
    await syncWallet({ client: c, wallet: shielded, authority, config: { requireSlot: slot } });
    const record = await fetchUserRecord({ rpc: c, owner: authority.solanaPublicKey() }).catch(
      () => undefined,
    );
    setUnregistered(record === undefined);
    return {
      wallet: shielded,
      slot,
      viewingPublicKey: shielded.identity.viewingPublicKey.toBytes(),
      client: c,
    };
  }, [client, shieldedWallet]);

  const refresh = useCallback(
    async (ring: Address) => {
      const { wallet: shielded } = await sync();
      const total = shielded
        .utxos()
        .filter((e) => !e.spent && e.utxo.asset === SOL_MINT && e.utxo.ringProgramId === ring)
        .reduce((sum, e) => sum + e.utxo.amount, 0n);
      setSession((prev) => (prev && prev.wallet === address ? { ...prev, balance: total } : prev));
      return total;
    },
    [address, sync],
  );

  const deposit = useCallback(
    async (ring: Address, lamports: bigint) => {
      const { authority, owner } = await shieldedWallet();
      const signature = await sendTransaction(
        wallet,
        await buildRingDepositTransaction({
          client: await client(),
          ringProgramId: ring,
          feePayer: owner,
          recipient: await authority.shieldedAddress(),
          amount: lamports,
        }),
      );
      await refresh(ring);
      return signature;
    },
    [client, refresh, shieldedWallet, wallet],
  );

  const transfer = useCallback(
    async (ring: Ring, lamports: bigint, recipient: Recipient) => {
      const { authority, shielded, owner } = await shieldedWallet();
      const c = await client();
      await refresh(ring.id);
      const signature = await sendTransaction(
        wallet,
        await buildRingTransferTransaction({
          client: c,
          ringProgramId: ring.id,
          wallet: shielded,
          authority,
          feePayer: owner,
          recipient,
          amount: lamports,
          lookupTable: await lookupTable(c, ring, wallet),
        }),
      );
      await refresh(ring.id);
      return signature;
    },
    [client, refresh, shieldedWallet, wallet],
  );

  const registered = useCallback(
    async (recipient: Address) => (await fetchUserRecord({ rpc: await client(), owner: recipient })) !== undefined,
    [client],
  );

  const withdraw = useCallback(
    async (ring: Ring, lamports: bigint, recipient: Address) => {
      const { authority, shielded, owner } = await shieldedWallet();
      const c = await client();
      await refresh(ring.id);
      const signature = await sendTransaction(
        wallet,
        await buildRingWithdrawalTransaction({
          client: c,
          ringProgramId: ring.id,
          wallet: shielded,
          authority,
          feePayer: owner,
          recipient,
          amount: lamports,
          lookupTable: await lookupTable(c, ring, wallet),
        }),
      );
      await refresh(ring.id);
      return signature;
    },
    [client, refresh, shieldedWallet, wallet],
  );

  const register = useCallback(async () => {
    const { authority, owner } = await shieldedWallet();
    const transaction = await buildRegistrationTransaction({
      client: await client(),
      owner,
      address: await authority.shieldedAddress(),
    });
    if (transaction === undefined) {
      setUnregistered(false);
      return "already registered";
    }
    const signature = await sendTransaction(wallet, transaction);
    setUnregistered(false);
    return signature;
  }, [client, shieldedWallet, wallet]);

  const burn = useCallback(
    (ring: Ring, lamports: bigint) => transfer(ring, lamports, freshRecipient()),
    [transfer],
  );

  const value = useMemo<Shielded>(
    () => ({
      balance: current?.balance,
      address: current?.address,
      sync,
      refresh,
      deposit,
      transfer,
      withdraw,
      registered,
      unregistered,
      register,
      burn,
    }),
    [
      current?.balance,
      current?.address,
      sync,
      refresh,
      deposit,
      transfer,
      withdraw,
      registered,
      unregistered,
      register,
      burn,
    ],
  );
  return <ShieldedContext.Provider value={value}>{children}</ShieldedContext.Provider>;
}

function freshRecipient(): ShieldedAddress {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return ShieldedKeypair.fromKeypair(SigningKey.fromEd25519Bytes(seed as Bytes32)).shieldedAddress();
}

const createdTable = (ring: Address) =>
  stored<Address | undefined>(`ring-auditor.lookup-table.${ring}`, (raw) =>
    typeof raw === "string" && isAddress(raw) ? raw : undefined,
  );

async function lookupTable(
  client: ZolanaClient,
  ring: Ring,
  wallet: WalletContextState,
): Promise<Address> {
  if (ring.lookupTable) return ring.lookupTable;
  const created = createdTable(ring.id);
  const existing = created.load();
  if (existing) return existing;
  const table = await buildRingLookupTableTransaction({
    client,
    ringProgramId: ring.id,
    feePayer: connectedAddress(wallet),
  });
  await sendTransaction(wallet, table.transaction);
  // A lookup table serves transactions only from the slot after its writes.
  const writtenAt = await client.solanaRpc.getSlot().send();
  while ((await client.solanaRpc.getSlot().send()) <= writtenAt) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  created.save(table.address);
  return table.address;
}
