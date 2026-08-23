"use client";

import { ArrowRight, PaperPlaneTilt } from "@phosphor-icons/react";
import { useState } from "react";
import { Copyable, Hint, Modal } from "./ui";

export function GrantRequest({ label, readerKey }: { label: string; readerKey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Request a grant from the ring operator"
        className="glow-accent inline-flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent-ground px-2.5 py-1 text-xs text-accent transition-colors hover:border-accent hover:bg-accent hover:text-white"
      >
        <PaperPlaneTilt size={13} />
        Request grant
      </button>
      {open && (
        <Modal title={`Grant for ${label}`} onClose={() => setOpen(false)}>
          <p className="text-sm">
            Send this key to the ring operator. The ring authority grants it on chain, then it
            reads the whole ring. The key is public.
          </p>
          <Copyable label="Reader key" value={readerKey} />
          <Copyable
            label="What the operator runs in the ring repository"
            value={`just grant-reader ${readerKey}`}
          />
          <Hint>
            An operator with the authority wallet can also open this page and grant the key from the
            Passkeys card. Once granted, Ring auditor <ArrowRight size={12} className="inline align-[-1px]" />{" "}
            Sign and read.
          </Hint>
        </Modal>
      )}
    </>
  );
}
