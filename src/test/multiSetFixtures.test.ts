import { validateSetSnapshot } from "../data/sets";
import { MULTI_SET_FIXTURES } from "./multiSetFixtures";

describe("realistic multi-Set fixtures", () => {
  it("cover independent assets, LP decimals, pause states, liquidity, locks, and positions", () => {
    expect(MULTI_SET_FIXTURES).toHaveLength(2);
    expect(new Set(MULTI_SET_FIXTURES.map((fixture) => fixture.pool.contract.address)).size).toBe(2);
    expect(new Set(MULTI_SET_FIXTURES.map((fixture) => fixture.pool.lpToken.decimals)).size).toBe(2);
    expect(new Set(MULTI_SET_FIXTURES.flatMap((fixture) => fixture.pool.assets.map((asset) => asset.id))).size).toBe(4);
    expect(MULTI_SET_FIXTURES.some((fixture) => fixture.state.trading.paused)).toBe(true);
    expect(MULTI_SET_FIXTURES.every((fixture) => (fixture.state.externalLiquiditySources?.length ?? 0) > 0)).toBe(true);
    expect(new Set(MULTI_SET_FIXTURES.map((fixture) => fixture.pool.quotePolicy.allowedLockDays.join(","))).size).toBe(2);
    expect(MULTI_SET_FIXTURES.every((fixture) => fixture.wallet.shares.totalAttributed > 0n)).toBe(true);
  });

  it("keeps each definition, detail, state, and wallet snapshot internally consistent", () => {
    for (const fixture of MULTI_SET_FIXTURES) {
      expect(validateSetSnapshot(fixture.definition.id, fixture.definition, fixture.pool, fixture.state)).toBeNull();
      expect(fixture.wallet.blockNumber).toBe(BigInt(fixture.state.blockNumber));
      expect(fixture.wallet.chainId).toBe(fixture.definition.chainId);
    }
  });
});
