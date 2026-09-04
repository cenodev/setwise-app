import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ActivityRecord, RoutedSwapLifecycle } from "../features/activity/store";
import { sameChainQuote } from "../data/swapRouter/fixtures";
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
const destinationHash = `0x${"b".repeat(64)}` as const;

function routedTracking(lifecycle: RoutedSwapLifecycle) {
  return {
    destinationChainId: 56,
    lifecycle,
    quote: sameChainQuote,
    quoteId: sameChainQuote.quoteId,
    routeProvider: sameChainQuote.providerId,
    sourceChainId: 56,
  };
}

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

describe("routed swap activity", () => {
  beforeEach(() => { mocks.records = []; });

  function routedRecord(lifecycle: RoutedSwapLifecycle, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
    return {
      chainId: 56,
      hash,
      id: `routed-${lifecycle}`,
      input: { amount: "25", symbol: "USDC" },
      operation: "swap",
      output: { amount: "24.9125", symbol: "USDT" },
      routed: routedTracking(lifecycle),
      status: "pending",
      submitted: true,
      timestamp: 1,
      ...overrides,
    } as ActivityRecord;
  }

  it("presents a delivered route with provider, quote, and both transaction hashes", () => {
    mocks.records = [routedRecord("delivered", {
      routed: {
        ...routedTracking("delivered"),
        destinationHash,
      },
      status: "success",
    })];

    render(<MemoryRouter><ActivityPage /></MemoryRouter>);

    const card = screen.getByRole("article", { name: "USDC → USDT" });
    expect(within(card).getByText("fixture")).toBeVisible();
    expect(within(card).getByText(sameChainQuote.quoteId)).toBeVisible();
    expect(within(card).getByText("25 USDC on BNB Smart Chain")).toBeVisible();
    expect(within(card).getByText("Received")).toBeVisible();
    expect(within(card).getByText("24.9125 USDT on BNB Smart Chain")).toBeVisible();
    expect(within(card).getByRole("link", { name: /Source 0xaaaa…aaaa/ })).toHaveAttribute(
      "href",
      `https://bscscan.com/tx/${hash}`,
    );
    expect(within(card).getByRole("link", { name: /Destination 0xbbbb…bbbb/ })).toHaveAttribute(
      "href",
      `https://bscscan.com/tx/${destinationHash}`,
    );
  });

  it.each([
    ["partially-delivered", "partial", /Partially delivered — the full output was not received/],
    ["refunded", "refunded", /Refunded to the source wallet — destination token not received/],
    ["failed", "failed", /Not delivered/],
    ["unknown", "pending", /Settlement status unknown/],
  ] as const)("never claims receipt of the output for %s routes", (lifecycle, status, expected) => {
    mocks.records = [routedRecord(lifecycle, { status })];

    render(<MemoryRouter><ActivityPage /></MemoryRouter>);

    const card = screen.getByRole("article", { name: "USDC → USDT" });
    expect(within(card).getByText(lifecycle)).toBeVisible();
    expect(within(card).getByText(expected)).toBeVisible();
    expect(within(card).queryByText("Received")).not.toBeInTheDocument();
    expect(within(card).getByText(/expected on/)).toBeVisible();
  });

  it("surfaces provider detail and in-flight settlement for unfinished routes", () => {
    mocks.records = [routedRecord("destination-pending", {
      routed: {
        ...routedTracking("destination-pending"),
        providerDetail: "Destination leg is being bridged",
      },
    })];

    render(<MemoryRouter><ActivityPage /></MemoryRouter>);

    const card = screen.getByRole("article", { name: "USDC → USDT" });
    expect(within(card).getByText("Settling on the destination chain")).toBeVisible();
    expect(within(card).getByText("Destination leg is being bridged")).toBeVisible();
    expect(within(card).queryByText("Received")).not.toBeInTheDocument();
  });

  it("keeps legacy swap records rendering a plain receipt", () => {
    mocks.records = [{
      chainId: 97,
      id: "legacy-swap",
      input: { amount: "1", symbol: "USDT" },
      operation: "swap",
      output: { amount: "2", symbol: "TOKEN" },
      status: "success",
      timestamp: 3,
    }];

    render(<MemoryRouter><ActivityPage /></MemoryRouter>);

    const card = screen.getByRole("article", { name: "USDT → TOKEN" });
    expect(within(card).getByText("Received")).toBeVisible();
    expect(within(card).getByText("2 TOKEN")).toBeVisible();
    expect(within(card).queryByText(/Route provider/i)).not.toBeInTheDocument();
  });
});
