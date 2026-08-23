import { base58 } from "@scure/base";
import { isAddress, type Address } from "@solana/kit";
import { ShieldedAddress } from "@heliuslabs/zolana/keypair";

/** Base58 over the SDK's byte form, which the CLI prints. */
export function encodeShieldedAddress(address: ShieldedAddress): string {
  return base58.encode(address.toBytes());
}

export function decodeShieldedAddress(text: string): ShieldedAddress | undefined {
  try {
    return ShieldedAddress.fromBytes(base58.decode(text.trim()));
  } catch {
    return undefined;
  }
}

export type Recipient = Address | ShieldedAddress;

/** A shielded address works unregistered, a Solana address must be registered on chain. */
export function parseRecipient(text: string): Recipient | undefined {
  const trimmed = text.trim();
  return decodeShieldedAddress(trimmed) ?? (isAddress(trimmed) ? trimmed : undefined);
}
