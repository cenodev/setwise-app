import type { Address } from "viem";

import {
  assertSwapPreflightContext,
  atomicApprovalPreflightNotice,
  preflightRouterSwap,
  statefulAtomicBatchPreflightAvailable,
  type RouterSwapPreflightInput,
  type SwapPreflightContext,
} from "./preflight";

const account = "0x1000000000000000000000000000000000000000" as Address;
const poolAddress = "0x2000000000000000000000000000000000000000" as Address;
const routerAddress = "0x3000000000000000000000000000000000000000" as Address;
const otherAddress = "0x4000000000000000000000000000000000000000" as Address;

function context(overrides: Partial<SwapPreflightContext> = {}): SwapPreflightContext {
  return {
    account,
    chainId: 97,
    online: true,
    poolAddress,
    poolId: "set-a",
    quoteId: "quote-a",
    routerAddress,
    ...overrides,
  };
}

function preflight(overrides: Partial<RouterSwapPreflightInput> = {}) {
  const getCode = vi.fn().mockResolvedValue("0x6000");
  const call = vi.fn().mockResolvedValue({ data: "0x" });
  return {
    call,
    getCode,
    input: {
      account,
      allowance: 10n,
      balance: 10n,
      chainId: 97,
      client: { call, getCode },
      expectedChainId: 97,
      firmInput: 10n,
      gasReserve: 1n,
      inputNative: false,
      inputSymbol: "USDT",
      mustSubmitBy: new Date(2_000).toISOString(),
      nativeBalance: 1n,
      now: () => 1_000,
      routerAddress,
      swapsPaused: false,
      transaction: { chainId: 97, data: "0x1234", to: routerAddress, value: "0" },
      ...overrides,
    } satisfies RouterSwapPreflightInput,
  };
}

describe("swap preflight", () => {
  it("simulates the exact trusted Router transaction after verifying deployed code", async () => {
    const scenario = preflight();
    await preflightRouterSwap(scenario.input);

    expect(scenario.getCode).toHaveBeenCalledWith({ address: routerAddress });
    expect(scenario.call).toHaveBeenCalledWith({
      account,
      data: "0x1234",
      to: routerAddress,
      value: 0n,
    });
    expect(scenario.getCode.mock.invocationCallOrder[0]).toBeLessThan(scenario.call.mock.invocationCallOrder[0]);
  });

  it.each([
    ["wrong chain", { chainId: 56 }, /BSC Testnet/],
    ["wrong target", { transaction: { chainId: 97, data: "0x1234", to: otherAddress, value: "0" } }, /trusted Set Router/],
    ["expired quote", { now: () => 2_000 }, /expired/],
    ["paused Set", { swapsPaused: true }, /paused/],
    ["insufficient balance", { balance: 9n }, /Insufficient USDT/],
    ["changed allowance", { allowance: 9n }, /allowance changed or is insufficient/i],
    ["wrong native value", { transaction: { chainId: 97, data: "0x1234", to: routerAddress, value: "1" } }, /incorrect native value/],
  ] as const)("fails closed for %s", async (_name, overrides, message) => {
    const scenario = preflight(overrides);
    await expect(preflightRouterSwap(scenario.input)).rejects.toThrow(message);
    expect(scenario.call).not.toHaveBeenCalled();
  });

  it("requires deployed Router code and maps eligibility simulation failures", async () => {
    const missing = preflight();
    missing.getCode.mockResolvedValueOnce(undefined);
    await expect(preflightRouterSwap(missing.input)).rejects.toThrow(/no deployed code/i);
    expect(missing.call).not.toHaveBeenCalled();

    const paused = preflight();
    paused.call.mockRejectedValueOnce(new Error("execution reverted: trading paused"));
    await expect(preflightRouterSwap(paused.input)).rejects.toThrow(/paused on chain/i);

    const unregistered = preflight();
    unregistered.call.mockRejectedValueOnce(new Error("execution reverted: pool not registered"));
    await expect(preflightRouterSwap(unregistered.input)).rejects.toThrow(/not registered/i);
  });

  it("checks exact native value plus gas reserve", async () => {
    const scenario = preflight({
      allowance: 0n,
      balance: 0n,
      firmInput: 10n,
      inputNative: true,
      nativeBalance: 11n,
      transaction: { chainId: 97, data: "0x1234", to: routerAddress, value: "10" },
    });
    await expect(preflightRouterSwap(scenario.input)).resolves.toBeUndefined();

    scenario.input.nativeBalance = 10n;
    await expect(preflightRouterSwap(scenario.input)).rejects.toThrow(/exact swap value and gas reserve/i);
  });

  it.each([
    ["account", { account: otherAddress }, /account changed/],
    ["chain", { chainId: 56 }, /network changed/],
    ["connectivity", { online: false }, /Connectivity changed/],
    ["Set", { poolId: "set-b" }, /Selected Set changed/],
    ["quote", { quoteId: "quote-b" }, /quote changed/],
    ["Router", { routerAddress: otherAddress }, /Router changed/],
  ] as const)("invalidates preflight when %s changes", (_name, overrides, message) => {
    expect(() => assertSwapPreflightContext(context(), context(overrides))).toThrow(message);
  });

  it("documents the fail-safe sequential strategy for stateful atomic batches", () => {
    expect(statefulAtomicBatchPreflightAvailable).toBe(false);
    expect(atomicApprovalPreflightNotice).toMatch(/cannot simulate an approval-plus-swap batch/i);
    expect(atomicApprovalPreflightNotice).toMatch(/separate exact approval/i);
  });
});
