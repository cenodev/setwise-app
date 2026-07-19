import {
  atomicToDecimal,
  decimalInputError,
  decimalToAtomic,
  fillByTargetWeights,
} from "./decimal";

describe("decimal amounts", () => {
  it("converts without using JavaScript number arithmetic", () => {
    expect(decimalToAtomic("123456789.123456", 6)).toBe(123456789123456n);
    expect(atomicToDecimal(123456789123456n, 6)).toBe("123456789.123456");
  });

  it("rejects invalid precision and exponent notation", () => {
    expect(decimalInputError("1.001", 2)).toMatch(/at most 2/);
    expect(decimalInputError("1e6", 18)).toMatch(/decimal/);
    expect(() => decimalToAtomic("0.0000001", 6)).toThrow(/at most 6/);
  });

  it("fills requested token amounts by target USD weights", () => {
    expect(fillByTargetWeights("100", [
      { decimals: 6, priceUsd: "1", weight: 60 },
      { decimals: 18, priceUsd: "20", weight: 40 },
    ])).toEqual(["60", "2"]);
  });
});
