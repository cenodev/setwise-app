import type { Address } from "viem";

import type { FirmWithdrawalQuote, WithdrawalQuote } from "../../data/rfq/withdrawals";
import { canReceiveNative, mapWithdrawalOutputs, shareShortcut, validateFirmWithdrawal } from "./model";

const pool = "0x1000000000000000000000000000000000000000" as Address;
const investor = "0x2000000000000000000000000000000000000000" as Address;
const wrappedNative = "0x3000000000000000000000000000000000000000" as Address;
const token = "0x4000000000000000000000000000000000000000" as Address;
const until = "2030-01-01T00:00:10.000Z";

const assets = [
  { address: wrappedNative, decimals: 18, id: "WBNB", index: 0, symbol: "WBNB", weight: 50 },
  { address: token, decimals: 6, id: "USDT", index: 1, symbol: "USDT", weight: 50 },
];

const indicative = {
  execution: "requires-firm-quote",
  indicativeQuoteId: "indicative-1",
  input: { amount: "1", asset: "SETWISE", atomicAmount: "1000000000000000000", decimals: 18 },
  marketSnapshot: [],
  mode: "single-asset",
  operation: "withdrawal",
  outputs: [{ amount: "2", asset: "WBNB", atomicAmount: "2000000000000000000", decimals: 18 }],
  pricedAt: "2030-01-01T00:00:00.000Z",
  quoteType: "indicative",
  stateSnapshot: { chainId: 97, poolAddress: pool, poolId: "pool", tradingPaused: false },
  validUntil: until,
  warnings: [],
} satisfies WithdrawalQuote;

const firm = {
  firmQuoteId: "firm-1",
  investor,
  mode: "single-asset",
  mustSubmitBy: until,
  operation: "withdrawal",
  output: indicative.outputs[0],
  quoteType: "firm",
  receiveNative: true,
  requirements: { minimumPoolTokenBalance: indicative.input.atomicAmount, sender: investor },
  shares: indicative.input,
  status: "executable",
  transaction: { chainId: 97, data: "0x1234", method: "withdrawSingleAsset", to: pool, value: "0" },
} satisfies FirmWithdrawalQuote;

describe("withdrawal model", () => {
  it("calculates 25/50/75/Max from unlocked shares using bigint", () => {
    expect([25, 50, 75, 100].map((percentage) =>
      shareShortcut(101n, percentage as 25 | 50 | 75 | 100))).toEqual([25n, 50n, 75n, 101n]);
  });

  it("only offers native output for the configured wrapped-native asset", () => {
    expect(canReceiveNative(wrappedNative, wrappedNative)).toBe(true);
    expect(canReceiveNative(token, wrappedNative)).toBe(false);
  });

  it("maps proportional outputs into contract asset order", () => {
    const quote = {
      ...indicative,
      execution: "direct-onchain",
      mode: "proportional",
      outputs: [
        { amount: "3", asset: "USDT", atomicAmount: "3000000", decimals: 6 },
        indicative.outputs[0],
      ],
    } satisfies WithdrawalQuote;
    expect(mapWithdrawalOutputs(quote, assets).map(({ asset }) => asset.id)).toEqual(["WBNB", "USDT"]);
  });

  it("validates sender, pool, value, balance, native selection, and expiry", () => {
    const base = {
      address: investor,
      chainId: 97,
      firm,
      indicative,
      now: Date.parse("2030-01-01T00:00:00.000Z"),
      outputAssetId: "WBNB",
      poolAddress: pool,
      receiveNative: true,
      unlockedBalance: 2_000_000_000_000_000_000n,
    };
    expect(() => validateFirmWithdrawal(base)).not.toThrow();
    expect(() => validateFirmWithdrawal({ ...base, unlockedBalance: 1n })).toThrow(/Insufficient unlocked/);
    expect(() => validateFirmWithdrawal({ ...base, receiveNative: false })).toThrow(/native output/);
    expect(() => validateFirmWithdrawal({ ...base, now: Date.parse(until) })).toThrow(/expired/);
    expect(() => validateFirmWithdrawal({
      ...base,
      firm: { ...firm, transaction: { ...firm.transaction, value: "1" } },
    })).toThrow(/native value/);
  });
});
