"use client";

import { ArrowsClockwise, Trash } from "@phosphor-icons/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import type { Address } from "@solana/kit";
import {
  RING_READ_ACCESS_COMPUTE_UNIT_LIMIT,
  grantReadAccessInstruction,
  parseReaderKey,
  revokeReadAccessInstruction,
} from "@heliuslabs/zolana/ring";
import { sendInstruction, walletAddress } from "@/lib/chain";
import { useAction, useLoaded, useRefreshToken } from "@/lib/hooks";
import { registerPasskey, type StoredPasskey } from "@/lib/passkeys";
import { ringRole, type RingRole } from "@heliuslabs/zolana/ring";
import { accountReader } from "@/lib/accounts";
import { GrantRequest } from "./GrantRequest";
import { Badge, Button, Card, Field, Hint, IconButton, Key } from "./ui";

export function Passkeys({
  ring,
  passkeys,
  onChange,
}: {
  ring: Address | undefined;
  passkeys: readonly StoredPasskey[];
  onChange: (passkeys: readonly StoredPasskey[]) => void;
}) {
  const wallet = useWallet();
  const authority = walletAddress(wallet);
  const [label, setLabel] = useState("");
  const [pasted, setPasted] = useState("");
  const { busy, run } = useAction();
  const [token, reload] = useRefreshToken();

  const roles = useLoaded(
    ring && { ring, token, keys: passkeys.map((p) => p.publicKey) },
    async ({ ring, keys }) =>
      new Map(
        await Promise.all(
          keys.map(
            async (key) =>
              [key, await ringRole({ rpc: accountReader(), ring, reader: parseReaderKey(key) })] as const,
          ),
        ),
      ),
  );
  const walletRole = useLoaded(ring && authority && { ring, token, authority }, ({ ring, authority }) =>
    ringRole({ rpc: accountReader(), ring, reader: authority }),
  );
  const isAuthority = walletRole.status === "ready" && walletRole.value === "authority";
  const roleOf = (p: StoredPasskey): RingRole | undefined =>
    roles.status === "ready" ? roles.value.get(p.publicKey) : undefined;

  const create = () =>
    run("create", async () => {
      const passkey = await registerPasskey(label || `passkey ${passkeys.length + 1}`);
      onChange([...passkeys, passkey]);
      setLabel("");
    });

  const grant = (readerText: string, revoke: boolean) =>
    run("grant", async () => {
      if (!ring || !authority) throw new Error("connect the authority wallet first");
      const reader = parseReaderKey(readerText);
      const instruction = revoke
        ? await revokeReadAccessInstruction({
            ringProgramId: ring,
            authority,
            reader,
            rentRecipient: authority,
          })
        : await grantReadAccessInstruction({ ringProgramId: ring, payer: authority, authority, reader });
      await sendInstruction(wallet, instruction, RING_READ_ACCESS_COMPUTE_UNIT_LIMIT);
      setPasted("");
      reload();
    });

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Passkeys
          <IconButton title="Reload grant status" onClick={reload}>
            <ArrowsClockwise size={14} />
          </IconButton>
        </span>
      }
    >
      <Hint>
        A passkey (Touch ID, YubiKey) reads the ring once the authority grants its key. Copy the
        key to the authority, or grant it here with the authority wallet.
      </Hint>
      {passkeys.map((p) => (
        <PasskeyRow
          key={p.credentialId}
          passkey={p}
          role={roleOf(p)}
          canGrant={isAuthority && !busy}
          onGrant={(revoke) => grant(p.publicKey, revoke)}
          onForget={() => onChange(passkeys.filter((q) => q.credentialId !== p.credentialId))}
        />
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button onClick={create} disabled={!!busy}>
          Create passkey
        </Button>
      </div>
      {isAuthority && (
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Key to grant, base58 or hex"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <Button onClick={() => grant(pasted, false)} disabled={!!busy || !pasted.trim()}>
            Grant
          </Button>
        </div>
      )}
    </Card>
  );
}

function PasskeyRow({
  passkey,
  role,
  canGrant,
  onGrant,
  onForget,
}: {
  passkey: StoredPasskey;
  role: RingRole | undefined;
  canGrant: boolean;
  onGrant: (revoke: boolean) => void;
  onForget: () => void;
}) {
  const granted = role === "delegated reader";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-col">
        <span className="text-sm">{passkey.label}</span>
        <Key value={passkey.publicKey} />
      </div>
      <div className="flex items-center gap-2">
        <Badge>{role ?? "…"}</Badge>
        {canGrant && <Button onClick={() => onGrant(granted)}>{granted ? "Revoke" : "Grant"}</Button>}
        {!granted && <GrantRequest label={passkey.label} readerKey={passkey.publicKey} />}
        <IconButton title="Forget this passkey" onClick={onForget}>
          <Trash size={14} />
        </IconButton>
      </div>
    </div>
  );
}
