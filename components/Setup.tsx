"use client";

import { useState } from "react";
import { toast } from "sonner";
import { isAddress } from "@solana/kit";
import { RING_RPC_URL, type Ring } from "@/lib/config";
import { Button, Code, Field, Hint, Modal } from "./ui";

/** `just ring-new` in the checkout generates the ring, the ring's own recipes deploy it. */
const STEPS: readonly { readonly text?: string; readonly code: string }[] = [
  {
    code: "git clone https://github.com/helius-labs/zolana",
  },
  {
    text: "Generate a ring and answer the wizard. It prints the program id it pinned, that is the ring address.",
    code: "cd zolana\njust ring-new",
  },
  {
    text: "In the generated ring, point it at devnet, then build, deploy, create the config, start the ring RPC and run one audited transfer.",
    code: "cd <the generated ring>\njust devnet\njust pipeline",
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
          placeholder="the address just ring-new printed"
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
          Then paste the program id above. The ring RPC that `just pipeline` starts must allow this
          origin, set RING_RPC_ALLOW_ORIGINS in the ring before it runs.
        </Hint>
      </div>
    </Modal>
  );
}
