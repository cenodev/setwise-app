/**
 * App-side error raised by the swap-router client. `code` is stable:
 * router envelope codes pass through unchanged, and transport or contract
 * failures use the client codes below. `details` carries the router's
 * per-path notes when present (for example per-provider quote failures);
 * display-only, never identifies money.
 */
export class SwapRouterApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: readonly { path?: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "SwapRouterApiError";
  }
}

/** Client-side codes; the router's envelope codes are passed through as-is. */
export const swapRouterClientErrorCodes = {
  networkError: "NETWORK_ERROR",
  httpError: "HTTP_ERROR",
  invalidResponse: "INVALID_RESPONSE",
  responseMismatch: "RESPONSE_MISMATCH",
} as const;
