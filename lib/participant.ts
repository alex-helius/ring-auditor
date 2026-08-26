import { createSolanaRpc, type Address, type Signature } from "@solana/kit";
import { fetchTransactionSlots, type TransactionSlots } from "@heliuslabs/zolana";
import { confirmedRingWithdrawals, ORIGIN_TRANSACTION_CONFIG } from "@heliuslabs/zolana/ring";
import type { PrivateTransaction } from "@heliuslabs/zolana/transaction";
import type { ShownOutput, ShownTransaction, ShownWithdrawal } from "./transactions";
import { SOLANA_RPC_URL } from "./config";
import type { Synced } from "./shielded";

export interface ParticipantView {
  title: string;
  items: ShownTransaction[];
}

/** The account a withdrawal credited, keyed by signature. */
export type WithdrawnTo = ReadonlyMap<string, string>;

/** The account a public withdrawal credited, per signature. */
export async function withdrawalRecipients(synced: Synced, ring?: Address): Promise<WithdrawnTo> {
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  // A settlement leg is named by the ring that signed the pool call, so with no
  // ring given every ring the wallet holds a note of is tried.
  const rings = ring
    ? [ring]
    : [
        ...new Set(
          synced.wallet
            .utxos()
            .flatMap((entry) => (entry.utxo.ringProgramId ? [entry.utxo.ringProgramId] : [])),
        ),
      ];
  const rows = synced.wallet
    .privateTransactions()
    .filter((row) => row.kind === "publicWithdrawal" && row.direction === "outbound");
  const found = await Promise.all(
    rows.map(async (row) => {
      const to = await rpc
        .getTransaction(row.id.signature as Signature, ORIGIN_TRANSACTION_CONFIG)
        .send()
        .then((tx) => rings.flatMap((each) => confirmedRingWithdrawals(tx, each))[0]?.recipient)
        .catch(() => undefined);
      return [row.id.signature, to] as const;
    }),
  );
  return new Map(
    found.flatMap(([signature, to]) => (to === undefined ? [] : [[signature, to]])),
  );
}

/** The output slots of a transaction, keyed by signature. */
export type SlotsBySignature = ReadonlyMap<string, TransactionSlots>;

/** Owner tags sit in the clear in the slot headers, so this needs no key. */
export async function transactionSlots(synced: Synced): Promise<SlotsBySignature> {
  // One signature can carry several events, and an inbound row's index is the
  // note's leaf, which picks the event the wallet took part in.
  const leaves = new Map<string, bigint>();
  for (const row of synced.wallet.privateTransactions()) {
    if (row.direction === "inbound" || row.kind === "merge") {
      leaves.set(row.id.signature, row.id.index);
    }
  }
  const signatures = [
    ...new Set(synced.wallet.privateTransactions().map((row) => row.id.signature)),
  ];
  const found = await Promise.all(
    signatures.map(async (signature) => {
      const leafIndex = leaves.get(signature);
      const slots = await fetchTransactionSlots({
        rpc: synced.client,
        signature: signature as Signature,
        ...(leafIndex === undefined ? {} : { leafIndex }),
      }).catch(() => undefined);
      return [signature, slots] as const;
    }),
  );
  return new Map(
    found.flatMap(([signature, slots]) => (slots === undefined ? [] : [[signature, slots]])),
  );
}

/**
 * A wallet holds notes of every ring it used, because the sync follows its view
 * tag. An outbound row is placed by the change note it left.
 */
export function participantViews(
  synced: Synced,
  ring: Address,
  wallet: Address,
  slots: SlotsBySignature,
  withdrawnTo: WithdrawnTo,
): ParticipantView[] {
  const rows = synced.wallet.privateTransactions();
  const byLeaf = new Map<bigint, PrivateTransaction>(
    rows
      .filter((row) => row.direction === "inbound" || row.kind === "merge")
      .map((row) => [row.id.index, row]),
  );
  // The wallet's own tag is its Solana address.
  const other = (signature: string) =>
    [...(slots.get(signature)?.ownerTags.values() ?? [])].find((tag) => tag !== wallet);
  // A send leaves no history row for its change, so a row is tied to the ring
  // by the leaves of its slots, one of which holds a note of this ring.
  const ringLeaves = new Set(
    synced.wallet
      .utxos()
      .filter((entry) => entry.utxo.ringProgramId === ring)
      .map((entry) => entry.outputContext.leafIndex),
  );
  const onRing = (signature: string) =>
    [...(slots.get(signature)?.leaves.values() ?? [])].some((leaf) => ringLeaves.has(leaf));
  // A note the wallet paid itself gets no history row, so its leaf names the
  // transaction that made it.
  const authored = new Map<bigint, PrivateTransaction>();
  for (const row of rows) {
    for (const leaf of slots.get(row.id.signature)?.leaves.values() ?? []) authored.set(leaf, row);
  }
  const ownNotes = new Map<string, number>();
  for (const entry of synced.wallet.utxos()) {
    if (entry.utxo.ringProgramId !== ring) continue;
    const row = authored.get(entry.outputContext.leafIndex);
    if (row) ownNotes.set(row.id.signature, (ownNotes.get(row.id.signature) ?? 0) + 1);
  }
  // A self-payment keeps two notes and shows no foreign tag, where a send or a
  // withdrawal keeps only its change.
  const selfPaid = (signature: string) =>
    other(signature) === undefined && (ownNotes.get(signature) ?? 0) > 1;

  const received = new Map<string, ShownTransaction>();
  for (const entry of synced.wallet.utxos()) {
    const leaf = entry.outputContext.leafIndex;
    const historic = byLeaf.get(leaf);
    const row = historic ?? authored.get(leaf);
    if (!row) continue;
    // A transfer can send one note to the default ring and keep its change here,
    // so a note that names no ring still belongs to this ring's history.
    const exited = entry.utxo.ringProgramId === undefined && onRing(row.id.signature);
    if (entry.utxo.ringProgramId !== ring && !exited) continue;
    if (!historic && !selfPaid(row.id.signature)) continue;
    // A deposit is the wallet paying itself in, so it has no counterparty.
    const sender = row.kind === "deposit" ? undefined : historic ? other(row.id.signature) : wallet;
    append(
      received,
      row,
      {
        slotIndex: Number(leaf),
        recipient: wallet,
        asset: entry.utxo.asset,
        amount: entry.utxo.amount,
        spent: entry.spent,
        exited,
      },
      { signers: [], ...(sender === undefined ? {} : { sender }), deposit: row.kind === "deposit" },
    );
  }

  const sent = new Map<string, ShownTransaction>();
  for (const row of rows) {
    // A payment to yourself is recorded as a split, so it belongs here too.
    if (row.direction === "inbound" || row.kind === "merge") continue;
    if (!onRing(row.id.signature)) continue;
    const exit = row.kind === "publicWithdrawal";
    // Every tag of a self-payment is the wallet's own, so no counterparty shows.
    const recipient = exit
      ? withdrawnTo.get(row.id.signature)
      : (other(row.id.signature) ?? wallet);
    append(
      sent,
      row,
      {
        slotIndex: sent.get(row.id.signature)?.outputs.length ?? 0,
        ...(recipient === undefined ? {} : { recipient }),
        asset: row.asset,
        amount: row.amount,
      },
      { signers: [wallet], sender: wallet },
      exit && recipient !== undefined
        ? [{ recipient, asset: row.asset, amount: row.amount }]
        : undefined,
    );
  }
  return [
    { title: "Sent", items: newestFirst(sent) },
    { title: "Received", items: newestFirst(received) },
  ];
}

function append(
  into: Map<string, ShownTransaction>,
  row: PrivateTransaction,
  output: ShownOutput,
  head: Readonly<{ signers: readonly string[]; sender?: string; deposit?: boolean }>,
  withdrawals?: readonly ShownWithdrawal[],
): void {
  const tx = into.get(row.id.signature) ?? {
    signature: row.id.signature,
    slot: row.id.slot,
    signers: head.signers,
    ...(head.sender === undefined ? {} : { sender: head.sender }),
    ...(head.deposit ? { deposit: true } : {}),
    ...(withdrawals === undefined ? {} : { withdrawals }),
    outputs: [],
    undecryptableSlots: [],
    nullifiers: [],
  };
  into.set(row.id.signature, { ...tx, outputs: [...tx.outputs, output] });
}

function newestFirst(items: Map<string, ShownTransaction>): ShownTransaction[] {
  return [...items.values()].sort((a, b) => (a.slot < b.slot ? 1 : a.slot > b.slot ? -1 : 0));
}
