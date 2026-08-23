import { RingRpc } from "@heliuslabs/zolana/ring";

/**
 * A dead load balancer node accepts the connection and never answers, so a
 * request without a deadline never settles and the page waits forever.
 */
export const RING_RPC_TIMEOUT_MS = 15_000;

/** `AbortSignal.timeout` raises `TimeoutError`, which is not a user cancellation. */
export function ringRpc(url: string, timeoutMs = RING_RPC_TIMEOUT_MS): RingRpc {
  return new RingRpc(url, {
    fetch: (input, init) =>
      fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs) }),
  });
}

export function isTimeout(e: unknown): boolean {
  for (let cause = e, depth = 0; cause !== undefined && depth < 8; depth++) {
    if (cause instanceof DOMException && cause.name === "TimeoutError") return true;
    cause = (cause as { cause?: unknown }).cause ?? (cause as { error?: unknown }).error;
  }
  return false;
}
