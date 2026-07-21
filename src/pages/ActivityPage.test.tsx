import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ActivityRecord } from "../features/activity/store";
import { ActivityPage } from "./ActivityPage";

const mocks = vi.hoisted(() => ({ records: [] as ActivityRecord[] }));

vi.mock("../features/activity/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../features/activity/store")>();
  return {
    ...original,
    readActivity: () => mocks.records,
    subscribeToActivity: () => () => undefined,
  };
});

const hash = `0x${"a".repeat(64)}` as const;

describe("ActivityPage", () => {
  beforeEach(() => { mocks.records = []; });

  it("explains the browser-local history when there are no records", () => {
    render(<MemoryRouter><ActivityPage /></MemoryRouter>);

    expect(screen.getByText(/not complete on-chain account history/i)).toBeVisible();
    expect(screen.getByText(/Deposits, withdrawals, and swaps/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Explore Sets" })).toHaveAttribute("href", "/sets");
  });

  it("renders accessible operation-specific cards with Set context and explorer links", () => {
    mocks.records = [
      {
        chainId: 97,
        deposits: [{ amount: "10", symbol: "USDT" }, { amount: "0.1", symbol: "WBNB" }],
        hash,
        id: "deposit-1",
        lockDays: 30,
        mode: "portfolio",
        operation: "deposit",
        setId: "bstock-ai",
        shares: { amount: "4.2", symbol: "SETWISE" },
        status: "success",
        timestamp: 1,
      },
      {
        chainId: 97,
        error: "Rejected in wallet",
        id: "withdrawal-1",
        mode: "single-asset",
        operation: "withdrawal",
        outputs: [{ amount: "5", symbol: "USDT" }],
        setId: "bstock-ai",
        shares: { amount: "1", symbol: "SETWISE" },
        status: "failed",
        timestamp: 2,
      },
      {
        chainId: 97,
        id: "legacy-swap",
        input: { amount: "1", symbol: "USDT" },
        operation: "swap",
        output: { amount: "2", symbol: "TOKEN" },
        status: "success",
        timestamp: 3,
      },
    ];

    render(<MemoryRouter><ActivityPage /></MemoryRouter>);

    const deposit = screen.getByRole("article", { name: "USDT + WBNB → SETWISE" });
    expect(within(deposit).getByText("10 USDT, 0.1 WBNB")).toBeVisible();
    expect(within(deposit).getByText("4.2 SETWISE")).toBeVisible();
    expect(within(deposit).getByText("30 days")).toBeVisible();
    expect(within(deposit).getByText("bstock-ai")).toBeVisible();
    expect(within(deposit).getByRole("link", { name: "bstock-ai" })).toHaveAttribute(
      "href",
      "/sets/bstock-ai/overview",
    );
    expect(within(deposit).getByRole("link", { name: /on explorer/ })).toHaveAttribute(
      "href",
      expect.stringContaining(hash),
    );

    const withdrawal = screen.getByRole("article", { name: "SETWISE → USDT" });
    expect(within(withdrawal).getByText("1 SETWISE")).toBeVisible();
    expect(within(withdrawal).getByText("5 USDT")).toBeVisible();
    expect(within(withdrawal).getByText("Rejected in wallet")).toBeVisible();
    expect(within(withdrawal).getByText("Attempted")).toBeVisible();

    expect(screen.getByRole("article", { name: "USDT → TOKEN" })).toBeVisible();
  });
});
