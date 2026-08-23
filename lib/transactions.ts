import { formatAmount, toBase58 } from "./format";

export interface ShownOutput {
  readonly slotIndex: number;
  /** The output slot's owner tag, base58, which is the recipient's address. */
  readonly recipient?: string;
  readonly asset: string;
  readonly amount: bigint;
  readonly spent?: boolean;
}

/** A public settlement leg, so value that left the ring in the clear. */
export interface ShownWithdrawal {
  /** A token account for an SPL leg, a wallet for a SOL leg. */
  readonly recipient: string;
  readonly asset: string;
  readonly amount: bigint;
}

export interface ShownTransaction {
  readonly signature: string;
  readonly slot: bigint;
  readonly withdrawals?: readonly ShownWithdrawal[];
  /** Value entering the ring, so no sender and nothing spent. */
  readonly deposit?: boolean;
  /** The signer that owns one of the outputs, so the one that spent. */
  readonly sender?: string;
  readonly signers: readonly string[];
  readonly outputs: readonly ShownOutput[];
  readonly undecryptableSlots: readonly number[];
  readonly nullifiers: readonly Uint8Array[];
}

export function searchText(tx: ShownTransaction): string {
  return [
    tx.signature,
    tx.slot.toString(),
    tx.sender ?? "",
    ...(tx.withdrawals ?? []).flatMap((w) => [w.recipient, w.asset]),
    ...tx.signers,
    ...tx.outputs.flatMap((o) => [
      o.recipient ?? "",
      o.asset,
      o.amount.toString(),
      formatAmount(o.amount, o.asset),
    ]),
    ...tx.nullifiers.map(toBase58),
  ]
    .join(" ")
    .toLowerCase();
}

export function matches(tx: ShownTransaction, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || searchText(tx).includes(needle);
}
