"use client";

import type { ReactNode } from "react";
import { explorerTxUrl } from "@/lib/config";
import { formatAmount, isSol, shortKey, toBase58 } from "@/lib/format";
import type { ShownTransaction } from "@/lib/transactions";
import { useShieldedAddress } from "@/lib/owners";
import { Address, Key } from "./ui";

export function TransactionCard({ tx }: { tx: ShownTransaction }) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          <a
            href={explorerTxUrl(tx.signature)}
            target="_blank"
            rel="noreferrer"
            title={`${tx.signature}\nopen in the explorer`}
            className="font-mono text-xs underline decoration-line underline-offset-2 hover:text-accent"
          >
            {shortKey(tx.signature, 8, 8)}
          </a>
          <Key value={tx.signature} head={0} tail={0} />
        </span>
        <span className="flex items-center gap-2 text-xs text-muted tabular-nums">
          {tx.deposit && (
            <span className="rounded-full border border-line px-2 py-0.5 text-accent">deposit</span>
          )}
          block {tx.slot.toString()}
        </span>
      </header>
      {tx.sender ? (
        <Row label="sender">
          <Address value={tx.sender} />
        </Row>
      ) : (
        tx.signers.length > 0 && (
          <Row label="signers">
            {tx.signers.map((signer) => (
              <Address key={signer} value={signer} />
            ))}
          </Row>
        )
      )}
      {(tx.withdrawals ?? []).length > 0 && (
        <Row label="withdrawn out of the ring">
          {(tx.withdrawals ?? []).map((w) => (
            <span key={`${w.recipient}:${String(w.amount)}`} className="flex items-center gap-2">
              <span className="rounded-full border border-accent/60 bg-accent-ground px-2 py-0.5 text-xs text-accent">
                {formatAmount(w.amount, w.asset)} in public
              </span>
              <span className="text-muted">to</span>
              <Address value={w.recipient} />
            </span>
          ))}
        </Row>
      )}
      <table className="w-full text-xs">
        <thead className="text-left text-muted">
          <tr>
            <th className="font-normal">output</th>
            <th className="font-normal">owner</th>
            <th className="font-normal">asset</th>
            <th className="text-right font-normal">amount</th>
          </tr>
        </thead>
        <tbody>
          {tx.outputs.map((output) => (
            <tr key={output.slotIndex} className="border-t border-line">
              <td className="py-1 tabular-nums">{output.slotIndex}</td>
              <td className="py-1">
                {output.recipient ? (
                  <Owner value={output.recipient} />
                ) : (
                  <span className="text-muted">—</span>
                )}
                {output.exited && (
                  <span
                    className="ml-1 rounded-full border border-accent/60 bg-accent-ground px-2 py-0.5 text-accent"
                    title="this note went to the default ring"
                  >
                    left the ring
                  </span>
                )}
              </td>
              <td className="py-1">
                {isSol(output.asset) ? "SOL" : <Address value={output.asset} token />}
              </td>
              <td className="py-1 text-right tabular-nums">
                {output.recipient === tx.sender && tx.sender !== undefined ? "-" : ""}
                {formatAmount(output.amount, output.asset)}
                {output.spent && <span className="ml-1 text-muted">spent</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tx.undecryptableSlots.length > 0 && (
        <Row label="undecryptable">
          <span className="tabular-nums">{tx.undecryptableSlots.join(", ")}</span>
        </Row>
      )}
      {tx.nullifiers.length > 0 && (
        <Row label="nullifiers">
          {tx.nullifiers.map((nullifier) => (
            <Key key={toBase58(nullifier)} value={toBase58(nullifier)} />
          ))}
        </Row>
      )}
    </article>
  );
}

/** An output owner, named by its shielded address once the registry answers. */
function Owner({ value }: { value: string }) {
  return <Address value={value} shielded={useShieldedAddress(value) ?? true} />;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}
