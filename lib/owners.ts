"use client";

import { useEffect, useState } from "react";
import { isAddress } from "@solana/kit";
import { resolveRegisteredAddress } from "@heliuslabs/zolana/wallet";
import { accountReader } from "./accounts";
import { encodeShieldedAddress } from "./address";

/** Owner tag to its registered shielded address, once resolved. */
const cache = new Map<string, string | undefined>();
const inFlight = new Map<string, Promise<unknown>>();

/** The shielded address behind an owner tag, absent until the registry answers. */
export function useShieldedAddress(owner: string | undefined): string | undefined {
  const [, bump] = useState(0);
  useEffect(() => {
    if (owner === undefined || cache.has(owner) || !isAddress(owner)) return;
    let live = true;
    const pending =
      inFlight.get(owner) ??
      resolveRegisteredAddress({ rpc: accountReader(), owner })
        .then((resolved) => {
          cache.set(owner, resolved && encodeShieldedAddress(resolved.address));
        })
        .catch(() => cache.set(owner, undefined))
        .finally(() => inFlight.delete(owner));
    inFlight.set(owner, pending);
    void pending.then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, [owner]);
  return owner === undefined ? undefined : cache.get(owner);
}
