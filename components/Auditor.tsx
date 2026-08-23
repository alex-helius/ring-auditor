"use client";

import { ringStore } from "@/lib/rings";
import { RING_RPC_URL, selectedRing } from "@/lib/config";
import { useStored } from "@/lib/hooks";
import { passkeyStore } from "@/lib/passkeys";
import { ShieldedProvider } from "@/lib/shielded";
import { Passkeys } from "./Passkeys";
import { ReadPanel } from "./ReadPanel";
import { RingCard } from "./RingCard";

export default function Auditor() {
  const [selection, setSelection] = useStored(ringStore);
  const [passkeys, setPasskeys] = useStored(passkeyStore);
  const ring = selectedRing(selection);
  return (
    <ShieldedProvider>
      <RingCard selection={selection} ring={ring} onChange={setSelection} />
      <Passkeys ring={ring?.id} passkeys={passkeys} onChange={setPasskeys} />
      <ReadPanel ring={ring?.id} rpcUrl={RING_RPC_URL} passkeys={passkeys} />
    </ShieldedProvider>
  );
}
