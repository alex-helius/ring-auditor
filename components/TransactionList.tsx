"use client";

import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";
import type { SkippedRingTransaction } from "@heliuslabs/zolana/ring";
import { matches, type ShownTransaction } from "@/lib/transactions";
import { TransactionCard } from "./TransactionCard";
import { Card, IconButton } from "./ui";

const PAGE = 10;

export function TransactionList({
  title,
  items,
  skipped,
  query,
  loadedSoFar,
  footer,
}: {
  title: string;
  items: readonly ShownTransaction[];
  skipped: readonly SkippedRingTransaction[];
  query: string;
  loadedSoFar: boolean;
  footer?: React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const shown = items.filter((tx) => matches(tx, query));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <h2 className="font-medium">
          {title}{" "}
          <span className="text-muted">
            {query.trim() ? `${shown.length} of ` : ""}
            {items.length} transaction{items.length === 1 ? "" : "s"}
            {loadedSoFar ? " loaded" : ""}
          </span>
        </h2>
        {pages > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <IconButton title="previous page" onClick={() => setPage(current - 1)} disabled={current === 0}>
              <CaretLeft size={14} weight="bold" />
            </IconButton>
            <span className="tabular-nums">
              {current + 1} / {pages}
            </span>
            <IconButton
              title="next page"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
            >
              <CaretRight size={14} weight="bold" />
            </IconButton>
          </div>
        )}
      </div>
      {shown.slice(current * PAGE, (current + 1) * PAGE).map((tx) => (
        <TransactionCard key={tx.signature} tx={tx} />
      ))}
      {skipped.length > 0 && (
        <Card title={`Skipped ${skipped.length}`}>
          {skipped.map((entry) => (
            <p key={entry.signature} className="text-xs text-muted">
              <span className="font-mono">{entry.signature}</span> {entry.reason}
            </p>
          ))}
        </Card>
      )}
      {footer}
    </section>
  );
}
