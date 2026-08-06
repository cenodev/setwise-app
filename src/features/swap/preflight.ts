import { isAddressEqual, type Address, type Hex, type PublicClient } from "viem";

export const atomicApprovalPreflightNotice =
  "This RPC cannot simulate an approval-plus-swap batch with the approval applied. For safety, the app uses a separate exact approval, then simulates the Set Router swap before opening the swap wallet request.";
export const statefulAtomicBatchPreflightAvailable = false;

export type SwapPreflightContext = {
  account: Address | undefined;
  chainId: number | undefined;
  online: boolean;
  poolAddress: Address | undefined;
  poolId: string;
  quoteId: string;
  routerAddress: Address;
};

export function assertSwapPreflightContext(
  expected: SwapPreflightContext,
  current: SwapPreflightContext,
): void {
  if (!current.online) throw new Error("Connectivity changed before Set Router preflight. Reconnect and review again.");
  if (!expected.account || !current.account || !isAddressEqual(expected.account, current.account)) {
    throw new Error("Connected account changed before Set Router preflight. Review again.");
  }
  if (expected.chainId !== current.chainId) {
    throw new Error("Wallet network changed before Set Router preflight. Switch to BSC Testnet and review again.");
  }
  if (expected.poolId !== current.poolId
    || !expected.poolAddress
    || !current.poolAddress
    || !isAddressEqual(expected.poolAddress, current.poolAddress)) {
    throw new Error("Selected Set changed before Set Router preflight. Review again.");
  }
  if (expected.quoteId !== current.quoteId) {
    throw new Error("Reviewed quote changed before Set Router preflight. Review the refreshed quote.");
  }
  if (!isAddressEqual(expected.routerAddress, current.routerAddress)) {
    throw new Error("Configured Set Router changed before preflight. Reload and review again.");
  }
}

type PreflightClient = Pick<PublicClient, "call" | "getCode">;

export type RouterSwapPreflightInput = {
  account: Address;
  allowance: bigint;
  balance: bigint;
  chainId: number;
  client: PreflightClient;
  expectedChainId: number;
  firmInput: bigint;
  gasReserve: bigint;
  inputNative: boolean;
  inputSymbol: string;
  mustSubmitBy: string;
  nativeBalance: bigint;
  now?: () => number;
  routerAddress: Address;
  swapsPaused: boolean;
  transaction: {
    chainId: number;
    data: Hex;
    to: Address;
    value: string;
  };
};

function errorDetail(error: unknown): string {
  if (!error || typeof error !== "object") return typeof error === "string" ? error : "Unknown error";
  const candidate = error as { details?: unknown; message?: unknown; shortMessage?: unknown };
  for (const value of [candidate.shortMessage, candidate.details, candidate.message]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Unknown error";
}

function simulationError(error: unknown): Error {
  const detail = errorDetail(error);
  const normalized = detail.toLowerCase();
  if (normalized.includes("paused")) {
    return new Error("Set swaps are paused on chain. Wait for swaps to resume and request a new quote.", { cause: error });
  }
  if (normalized.includes("unregistered") || normalized.includes("not registered") || normalized.includes("unknown pool")) {
    return new Error("This Set is not registered for Router swaps. Choose an eligible Set.", { cause: error });
  }
  if (normalized.includes("disabled") || normalized.includes("not enabled") || normalized.includes("ineligible")) {
    return new Error("This Set route is disabled or ineligible. Choose another route or retry after it is enabled.", { cause: error });
  }
  if (normalized.includes("network") || normalized.includes("rpc") || normalized.includes("fetch")
    || normalized.includes("timeout") || normalized.includes("http request")) {
    return new Error(`The RPC could not simulate the Set Router swap. Retry the preflight. ${detail}`, { cause: error });
  }
  return new Error(`Set Router simulation failed before wallet submission. ${detail}`, { cause: error });
}

export async function preflightRouterSwap(input: RouterSwapPreflightInput): Promise<void> {
  const now = input.now ?? Date.now;
  if (input.chainId !== input.expectedChainId || input.transaction.chainId !== input.expectedChainId) {
    throw new Error("Set Router preflight requires BSC Testnet. Switch networks and review again.");
  }
  if (!isAddressEqual(input.transaction.to, input.routerAddress)) {
    throw new Error("Executable transaction does not target the trusted Set Router.");
  }
  if (Date.parse(input.mustSubmitBy) <= now()) {
    throw new Error("Executable quote expired before Set Router preflight. Request a new quote.");
  }
  if (input.swapsPaused) {
    throw new Error("Set swaps are paused. Wait for swaps to resume and request a new quote.");
  }
  if (input.firmInput <= 0n) throw new Error("Executable quote has an invalid input amount.");

  const expectedValue = input.inputNative ? input.firmInput : 0n;
  if (BigInt(input.transaction.value) !== expectedValue) {
    throw new Error("Executable transaction has an incorrect native value.");
  }
  if (input.inputNative) {
    if (input.nativeBalance < input.firmInput + input.gasReserve) {
      throw new Error("Insufficient BNB balance for the exact swap value and gas reserve.");
    }
  } else {
    if (input.balance < input.firmInput) throw new Error(`Insufficient ${input.inputSymbol} balance at preflight.`);
    if (input.allowance < input.firmInput) {
      throw new Error("Set Router allowance changed or is insufficient. Approve the exact amount and retry.");
    }
    if (input.nativeBalance < input.gasReserve) throw new Error("Insufficient BNB for gas at preflight.");
  }

  let code: Hex | undefined;
  try {
    code = await input.client.getCode({ address: input.routerAddress });
  } catch (error) {
    throw new Error(
      `The RPC could not verify the configured Set Router deployment. Retry the preflight. ${errorDetail(error)}`,
      { cause: error },
    );
  }
  if (!code || code === "0x") {
    throw new Error("The configured Set Router has no deployed code. Wallet submission is blocked.");
  }
  if (Date.parse(input.mustSubmitBy) <= now()) {
    throw new Error("Executable quote expired while verifying the Set Router. Request a new quote.");
  }

  try {
    await input.client.call({
      account: input.account,
      data: input.transaction.data,
      to: input.routerAddress,
      value: expectedValue,
    });
  } catch (error) {
    throw simulationError(error);
  }
  if (Date.parse(input.mustSubmitBy) <= now()) {
    throw new Error("Executable quote expired during Set Router simulation. Request a new quote.");
  }
}
