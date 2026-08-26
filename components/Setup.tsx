"use client";

import { useState } from "react";
import { toast } from "sonner";
import { isAddress } from "@solana/kit";
import { INSTALL_URL, RING_RPC_URL, type Ring } from "@/lib/config";
import { Button, Code, Field, Hint, Modal } from "./ui";

/** The installer puts `zolana-ring` and `zolana` on PATH, the ring directory holds ring.toml and the keys. */
const STEPS: readonly { readonly text?: string; readonly code: string }[] = [
  {
    text: "Install the ring operator CLI and the zolana CLI.",
    code: `curl -fsSL ${INSTALL_URL} | sh`,
  },
  {
    text: "Deploying the ring program needs the Anza CLI on PATH.",
    code: 'sh -c "$(curl -sSfL https://release.anza.xyz/v4.0.2/install)"',
  },
  {
    text: "Generate a ring and answer the questions. It prints the program id it fixed, that is the ring address.",
    code: "zolana-ring new",
  },
  {
    text: "In the generated ring, point it at devnet, then deploy the program, create the config and run one audited transfer.",
    code: "cd <the generated ring>\nzolana-ring devnet\nzolana-ring pipeline",
  },
];

/** First run, no ring stored yet: ask for one, or say how to make one. */
export function Setup({ onAdd, onClose }: { onAdd: (ring: Ring) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");

  function submit() {
    const ring = { name: name.trim(), id: id.trim() };
    if (!ring.name) return toast.error("a name is required");
    if (!isAddress(ring.id)) return toast.error("the ring program id is not a Solana address");
    onAdd({ name: ring.name, id: ring.id });
  }

  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
  };

  return (
    <Modal title="Add your first ring" onClose={onClose}>
      <p className="text-sm">
        The page reads one ring at a time through the ring RPC at <span className="font-mono">{RING_RPC_URL}</span>.
        Name the ring and paste its program id, both are kept in this browser.
      </p>
      <div className="flex flex-col gap-3">
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={enter}
          placeholder="my-ring"
          autoFocus
        />
        <Field
          label="Ring program id"
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={enter}
          placeholder="the address zolana-ring new printed"
        />
        <div className="flex justify-end">
          <Button onClick={submit}>Add ring</Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <h3 className="text-sm font-medium">No ring yet? Make one</h3>
        <ol className="ml-5 list-decimal space-y-3 text-sm marker:text-muted">
          {STEPS.map((step) => (
            <li key={step.code}>
              {/* A flex `li` is no longer a list item and loses its marker. */}
              <div className="flex flex-col gap-1.5">
                {step.text && <span>{step.text}</span>}
                <Code>{step.code}</Code>
              </div>
            </li>
          ))}
        </ol>
        <Hint>
          Then paste the program id above. The ring RPC derives one auditor key per ring, so it
          serves a new ring with no restart. It answers only the pages RING_RPC_ALLOW_ORIGINS names.
        </Hint>
      </div>
    </Modal>
  );
}
