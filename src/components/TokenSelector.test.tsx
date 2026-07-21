import { fireEvent, render, screen } from "@testing-library/react";

import { TokenIcon } from "./TokenIdentity";
import { TokenSelector } from "./TokenSelector";

const options = [
  { address: "0x1000000000000000000000000000000000000000", id: "ONE", name: "One Token", symbol: "ONE" },
  { address: "0x2000000000000000000000000000000000000000", id: "TWO", name: "Two Token", symbol: "TWO" },
  { address: "0x3000000000000000000000000000000000000000", id: "THREE", name: "Three Token", symbol: "THREE" },
];

vi.mock("../data/tokens", () => ({
  enrichTokenDisplay: (asset: (typeof options)[number]) => ({ name: asset.name, symbol: asset.symbol }),
  useTokenMetadata: () => ({ data: undefined }),
}));

describe("TokenSelector", () => {
  it("selects enabled options by mouse and keyboard while preserving disabled options", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TokenSelector ariaLabel="Asset" chainId={97} options={options} value="ONE" onChange={onChange}
      isOptionDisabled={(option) => option.id === "TWO"} />);
    const trigger = screen.getByRole("combobox", { name: "Asset" });
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: /two token/i })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: /three token/i }));
    expect(onChange).toHaveBeenLastCalledWith("THREE");
    rerender(<TokenSelector ariaLabel="Asset" chainId={97} options={options} value="ONE" onChange={onChange}
      isOptionDisabled={(option) => option.id === "TWO"} />);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("THREE");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("replaces a broken logo with deterministic initials", () => {
    const { container } = render(<TokenIcon symbol="Test Coin" logoURI="https://assets.example/broken.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("TC")).toHaveClass("token-icon--fallback");
  });
});
