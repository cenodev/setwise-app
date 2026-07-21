import { MULTI_SET_FIXTURES } from "../test/multiSetFixtures";
import { loadSetDirectoryStates, setDirectoryFingerprint } from "./setDirectory";

describe("loadSetDirectoryStates", () => {
  it("loads realistic Sets with bounded concurrency and preserves registry order", async () => {
    let active = 0;
    let maximumActive = 0;
    const loadState = vi.fn(async (poolId: string) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      const match = MULTI_SET_FIXTURES.find((candidate) => candidate.definition.id === poolId);
      if (!match) throw new Error("missing fixture");
      return match.state;
    });

    const result = await loadSetDirectoryStates({
      concurrency: 1,
      definitions: MULTI_SET_FIXTURES.map((candidate) => candidate.definition),
      loadState,
    });

    expect(maximumActive).toBe(1);
    expect(result.map((entry) => entry.poolId)).toEqual(MULTI_SET_FIXTURES.map((entry) => entry.definition.id));
    expect(result.every((entry) => entry.status === "ready")).toBe(true);
  });

  it("isolates partial failures and refuses cross-Set state", async () => {
    const [first, second] = MULTI_SET_FIXTURES;
    const result = await loadSetDirectoryStates({
      definitions: [first.definition, second.definition],
      loadState: () => Promise.resolve(second.state),
    });

    expect(result[0]).toMatchObject({ poolId: first.definition.id, status: "error" });
    expect(result[0].status === "error" && result[0].error.message).toMatch(/different Set/);
    expect(result[1]).toMatchObject({ poolId: second.definition.id, status: "ready" });
  });

  it("encodes Set identity in the directory cache fingerprint", () => {
    const [first, second] = MULTI_SET_FIXTURES;
    expect(setDirectoryFingerprint([first.definition])).not.toBe(setDirectoryFingerprint([second.definition]));
    expect(setDirectoryFingerprint([first.definition, second.definition])).toBe(
      setDirectoryFingerprint([second.definition, first.definition]),
    );
  });
});
