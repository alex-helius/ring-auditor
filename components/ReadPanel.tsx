"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useState } from "react";
import type { Address } from "@solana/kit";
import {
  RING_READ_PAGE_LIMIT,
  parseReaderKey,
  type RingReadSigner,
  type SkippedRingTransaction,
} from "@heliuslabs/zolana/ring";
import { walletAddress } from "@/lib/chain";
import { ringRpcErrorMessage } from "@/lib/errors";
import { shortKey } from "@/lib/format";
import { useAction, useLoaded } from "@/lib/hooks";
import { participantViews, transactionSlots, withdrawalRecipients } from "@/lib/participant";
import { passkeySigner, type StoredPasskey } from "@/lib/passkeys";
import { ringRpc } from "@/lib/ring-rpc";
import { ringRole, senderOf } from "@heliuslabs/zolana/ring";
import { accountReader } from "@/lib/accounts";
import { getAddressDecoder } from "@solana/kit";
import { useShielded } from "@/lib/shielded";
import { walletSigner } from "@/lib/signers";
import type { ShownTransaction } from "@/lib/transactions";
import { GrantRequest } from "./GrantRequest";
import { TransactionList } from "./TransactionList";
import { Badge, Button, Card, Field, Hint, Select, Success } from "./ui";

type Mode = "auditor" | "participant";

const MODES: Record<Mode, { label: string; hint: string }> = {
  auditor: {
    label: "Ring auditor",
    hint: "The wallet must be the ring's authority or a reader it granted. It sees every transaction.",
  },
  participant: {
    label: "Participant",
    hint: "The wallet's own view from its local sync, the outputs it received and the transfers it sent. The ring RPC is not called.",
  },
};
const MODE_ORDER = ["auditor", "participant"] as const satisfies readonly Mode[];

const WALLET = "wallet";

/** Per signature, the RPC's page bound. */
const addressDecoder = getAddressDecoder();

const FETCH = RING_READ_PAGE_LIMIT;

const newestFirst = (items: readonly ShownTransaction[]): ShownTransaction[] =>
  [...items].sort((a, b) => Number(b.slot - a.slot));

const oldest = (slots: readonly bigint[]): bigint =>
  slots.reduce((low, slot) => (slot < low ? slot : low), slots[0] ?? 0n);

const streamsOf = (
  signer: RingReadSigner,
  audit: Stream<Uint8Array> | undefined,
  deposits: Stream<Uint8Array> | undefined,
): Older | undefined => (audit || deposits ? { signer, audit, deposits } : undefined);

/** One backward stream, absent once it reaches the end of the ring's history. */
interface Stream<C> {
  readonly cursor: C;
  /** Oldest slot this stream has reached. */
  readonly frontier: bigint;
}

interface Older {
  readonly signer: RingReadSigner;
  readonly audit: Stream<Uint8Array> | undefined;
  readonly deposits: Stream<Uint8Array> | undefined;
}

interface View {
  readonly title: string;
  readonly items: readonly ShownTransaction[];
  readonly skipped: readonly SkippedRingTransaction[];
  /** Present while either stream holds older pages. */
  readonly older: Older | undefined;
}

export function ReadPanel({
  ring,
  rpcUrl,
  passkeys,
}: {
  ring: Address | undefined;
  rpcUrl: string;
  passkeys: readonly StoredPasskey[];
}) {
  const wallet = useWallet();
  const shielded = useShielded();
  const [mode, setMode] = useState<Mode>("auditor");
  const [signerId, setSignerId] = useState(WALLET);
  const [views, setViews] = useState<readonly View[]>([]);
  const [fetchedBy, setFetchedBy] = useState<string>();
  const [query, setQuery] = useState("");
  // A read re-checks the role and remounts the lists.
  const [reads, setReads] = useState(0);

  const { hint } = MODES[mode];
  const address = walletAddress(wallet);
  const passkey = mode === "auditor" ? passkeys.find((p) => p.credentialId === signerId) : undefined;
  const readerKey = passkey?.publicKey ?? address;
  const role = useLoaded(
    ring && readerKey ? { ring, readerKey, reads } : undefined,
    ({ ring, readerKey }) =>
      ringRole({ rpc: accountReader(), ring, reader: parseReaderKey(readerKey) }),
  );

  /** The audited page of one stream, oldest slot reached alongside it. */
  async function auditPage(signer: RingReadSigner, cursor?: Uint8Array) {
    if (!ring) throw new Error("add a ring first");
    const page = await ringRpc(rpcUrl).getDecryptedTransactions({
      ringProgramId: ring,
      signer,
      limit: FETCH,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const items = page.items.map((item) => {
      const tags = item.outputs.map((output) => addressDecoder.decode(output.ownerTag));
      const sender = senderOf(item.signers, tags);
      return {
        signature: item.signature,
        slot: item.slot,
        signers: item.signers,
        ...(sender === undefined ? {} : { sender }),
        undecryptableSlots: item.undecryptableSlots,
        nullifiers: item.nullifiers,
        ...(item.withdrawals.length === 0 ? {} : { withdrawals: item.withdrawals }),
        outputs: item.outputs.map((output) => ({
          slotIndex: output.slotIndex,
          recipient: addressDecoder.decode(output.ownerTag),
          asset: output.asset,
          amount: output.amount,
        })),
      } satisfies ShownTransaction;
    });
    const slots = [...items, ...page.skipped].map((row) => row.slot);
    return {
      items,
      skipped: page.skipped,
      stream: page.cursor && { cursor: page.cursor, frontier: oldest(slots) },
    };
  }

  async function depositPage(cursor?: Uint8Array) {
    if (!ring) throw new Error("add a ring first");
    const page = await ringRpc(rpcUrl).ringDeposits({
      ringProgramId: ring,
      limit: Number(FETCH),
      ...(cursor === undefined ? {} : { cursor }),
    });
    const items = page.deposits.map((deposit) => ({
      signature: deposit.signature,
      slot: deposit.slot,
      deposit: true,
      signers: [],
      undecryptableSlots: [],
      nullifiers: [],
      outputs: [
        { slotIndex: 0, recipient: deposit.depositor, asset: deposit.asset, amount: deposit.amount },
      ],
    })) satisfies ShownTransaction[];
    // A page can find no deposit and still hold history, so the service reports
    // how far back it read.
    const frontier = page.oldestSlot ?? oldest(items.map((item) => item.slot));
    return { items, stream: page.cursor && { cursor: page.cursor, frontier } };
  }

  async function firstPage(signer: RingReadSigner): Promise<Omit<View, "title">> {
    const [audit, deposits] = await Promise.all([auditPage(signer), depositPage()]);
    return {
      items: newestFirst([...audit.items, ...deposits.items]),
      skipped: audit.skipped,
      older: streamsOf(signer, audit.stream, deposits.stream),
    };
  }

  const { busy, run } = useAction<"read" | "older">(
    useCallback((e: unknown) => ringRpcErrorMessage(e, rpcUrl), [rpcUrl]),
  );

  const read = () =>
    run("read", async () => {
      setViews([]);
      setFetchedBy(undefined);
      setReads((n) => n + 1);
      if (mode === "participant") {
        if (!ring || !address) throw new Error("connect a wallet first");
        const synced = await shielded.sync();
        const [slots, withdrawnTo] = await Promise.all([
          transactionSlots(synced),
          withdrawalRecipients(synced, ring),
        ]);
        setViews(
          participantViews(synced, ring, address, slots, withdrawnTo).map((v) => ({
            ...v,
            skipped: [],
            older: undefined,
          })),
        );
        setFetchedBy(`from local wallet sync at block ${synced.slot}`);
        return;
      }
      const signer = passkey ? passkeySigner(passkey) : walletSigner(wallet);
      if (!signer) throw new Error("connect a wallet first");
      setViews([{ title: "Ring", ...(await firstPage(signer)) }]);
      setFetchedBy(
        `signed by ${passkey ? `passkey ${passkey.label} ${shortKey(passkey.publicKey, 6, 4)}` : `wallet ${shortKey(address ?? "")}`}`,
      );
    });

  /**
   * Advances whichever stream has read the least far back, so the two walk down
   * together and the merged list stays complete behind their frontiers.
   */
  const older = (index: number, from: Older) =>
    run("older", async () => {
      const behind =
        from.audit && (!from.deposits || from.audit.frontier >= from.deposits.frontier);
      const audit = behind ? await auditPage(from.signer, from.audit?.cursor) : undefined;
      const deposits = behind ? undefined : await depositPage(from.deposits?.cursor);
      setViews((prev) =>
        prev.map((view, at) =>
          at === index
            ? {
                ...view,
                items: newestFirst([...view.items, ...(audit?.items ?? deposits?.items ?? [])]),
                skipped: [...view.skipped, ...(audit?.skipped ?? [])],
                older: streamsOf(
                  from.signer,
                  audit ? audit.stream : from.audit,
                  deposits ? deposits.stream : from.deposits,
                ),
              }
            : view,
        ),
      );
    });

  return (
    <>
      <Card title="Read as">
        <div className="flex flex-wrap gap-2">
          {MODE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={id === mode}
              className={`rounded-full border px-3 py-1 text-sm ${
                id === mode ? "border-accent bg-accent-ground text-text" : "border-line text-muted hover:text-text"
              }`}
            >
              {MODES[id].label}
            </button>
          ))}
        </div>
        <Hint>{hint}</Hint>
        {mode === "auditor" && passkeys.length > 0 && (
          <Select
            label="Sign with"
            value={passkey?.credentialId ?? WALLET}
            onChange={(e) => setSignerId(e.target.value)}
          >
            <option value={WALLET}>wallet</option>
            {passkeys.map((p) => (
              <option key={p.credentialId} value={p.credentialId}>
                passkey · {p.label}
              </option>
            ))}
          </Select>
        )}
        {readerKey && role.status !== "loading" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{passkey ? "passkey is" : "wallet is"}</span>
            <Badge>{role.status === "ready" ? role.value : role.error}</Badge>
            {mode === "auditor" && role.status === "ready" && role.value === "participant only" && (
              <GrantRequest label={passkey?.label ?? "wallet"} readerKey={readerKey} />
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={read} disabled={!!busy || !ring || !readerKey}>
            {mode === "participant"
              ? busy
                ? "Syncing…"
                : "Sync and read"
              : busy
                ? "Signing…"
                : "Sign and read"}
          </Button>
          {fetchedBy && <Success>fetched · {fetchedBy}</Success>}
        </div>
      </Card>
      {views.length > 0 && (
        <Field
          label="Search signature, block, signer, recipient, asset, amount, nullifier"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="…"
        />
      )}
      {views.map(({ title, items, skipped, older: from }, index) => (
        <TransactionList
          key={`${title}-${reads}`}
          title={title}
          items={items}
          skipped={skipped}
          query={query}
          loadedSoFar={from !== undefined}
          footer={
            from && (
              <Button onClick={() => older(index, from)} disabled={!!busy}>
                Load older (sign)
              </Button>
            )
          }
        />
      ))}
    </>
  );
}
