import { WalletError } from "@solana/wallet-adapter-base";
import { RingError } from "@heliuslabs/zolana/ring";

const REJECTED = /rejected|cancel|denied|declined/i;

/** A wallet or passkey prompt the user dismissed, anywhere in the cause chain. */
export function isUserRejection(e: unknown): boolean {
  for (let cause = e, depth = 0; cause !== undefined && depth < 8; depth++) {
    if (cause instanceof WalletError && REJECTED.test(cause.message)) return true;
    if ((cause as { code?: unknown }).code === 4001) return true;
    if (cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "AbortError")) {
      return true;
    }
    cause = (cause as { cause?: unknown }).cause ?? (cause as { error?: unknown }).error;
  }
  return false;
}

/** `code` when the error carries no detail, so the chain reads as one line. */
function described(e: unknown): string | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const { code, details, message } = e as {
    code?: unknown;
    details?: Record<string, unknown>;
    message?: unknown;
  };
  const detail = Object.entries(details ?? {})
    .filter(([key]) => key !== "method")
    .map(([, value]) => String(value))
    .join(" ");
  if (typeof code === "string") return detail ? `${code} ${detail}` : code;
  return typeof message === "string" ? message : undefined;
}

/** Every code and detail down the cause chain, outermost first. */
export function errorMessage(e: unknown): string {
  const parts: string[] = [];
  for (let cause = e, depth = 0; cause !== undefined && cause !== null && depth < 6; depth++) {
    const part = described(cause);
    if (part && !parts.includes(part)) parts.push(part);
    cause = (cause as { cause?: unknown }).cause;
  }
  if (parts.length > 0) return parts.join(", ");
  return e instanceof Error ? e.message : String(e);
}

export function ringRpcErrorMessage(e: unknown, rpcUrl: string): string {
  if (e instanceof RingError && e.code === "RING_RPC_TRANSPORT") {
    return `no ring RPC at ${rpcUrl}, start it with --allow-origin ${location.origin}`;
  }
  return errorMessage(e);
}
