import { truncateAddress, truncateDecimal } from "./format";

describe("display formatting", () => {
  it("truncates an EVM address without changing its ends", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678"))
      .toBe("0x1234…5678");
  });

  it("truncates a decimal string without passing through Number", () => {
    expect(truncateDecimal("123456789.987654321", 4)).toBe("123456789.9876");
    expect(truncateDecimal("4", 4)).toBe("4");
  });
});
