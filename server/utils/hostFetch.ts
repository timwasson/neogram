/**
 * fetch() for static-host APIs (Neocities, Nekoweb, GitHub) with an overall deadline.
 *
 * Publishing runs inside the single build queue, so a request that never answers would stall
 * every member's publishing until undici's ~5 minute defaults gave up. Any caller-supplied signal
 * is still honoured.
 */
export const HOST_FETCH_TIMEOUT_MS = 90_000;

export function hostFetch(input: string | URL | Request, init: RequestInit = {}, timeoutMs = HOST_FETCH_TIMEOUT_MS): Promise<Response> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  return globalThis.fetch(input, { ...init, signal });
}
