import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import { RoutedSwapPage } from "./RoutedSwapPage";
import { SwapRouterApiError } from "../../data/swapRouter/errors";
import { swapQuoteSchema, type SwapQuote } from "../../data/swapRouter/schema";
import { partialProviderCapabilities, swapRouterCapabilities } from "../../data/swapRouter/fixtures";

const wallet = "0x2000000000000000000000000000000000000000";
const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const nvdaBase = "0xAbC0000000000000000000000000000000000001";
const nvdaOmegaEthereum = "0xAbC0000000000000000000000000000000000002";
const nvdaBackedEthereum = "0xAbC0000000000000000000000000000000000003";
const tslaBase = "0xAbC0000000000000000000000000000000000004";

const testTokens = [
  { address: nvdaBase, chainId: 8453, chainName: "Base", name: "NVIDIA xStock Base", provider: "backed", symbol: "NVDAx", underlyingSymbol: "NVDA" },
  { address: nvdaOmegaEthereum, chainId: 1, chainName: "Ethereum", name: "NVIDIA Omega", provider: "omega", symbol: "nNVDA", underlyingSymbol: "NVDA" },
  { address: nvdaBackedEthereum, chainId: 1, chainName: "Ethereum", name: "NVIDIA xStock", provider: "backed", symbol: "NVDAx", underlyingSymbol: "NVDA" },
  { address: tslaBase, chainId: 8453, chainName: "Base", name: "Tesla xStock", provider: "backed", symbol: "TSLAx", underlyingSymbol: "TSLA" },
  { address: "0x9990000000000000000000000000000000000009", chainId: 97, chainName: "BSC Testnet", name: "Mock bStock", provider: "mock", symbol: "mSTOCK" },
];

const mocks = vi.hoisted(() => {
  const account: { address: `0x${string}` | undefined; chainId: number | undefined } = {
    address: "0x2000000000000000000000000000000000000000",
    chainId: 1,
  };
  return {
    account,
    getSwapRouterCapabilities: vi.fn(),
    open: vi.fn(),
    readContract: vi.fn(),
    requestSwapQuotes: vi.fn<(input: { intent: SwapQuote["intent"]; signal?: AbortSignal }) => Promise<SwapQuote[]>>(),
    switchChain: vi.fn<(input: { chainId: number }) => Promise<void>>(),
  };
});

vi.mock("wagmi", () => ({
  useAccount: () => mocks.account,
  usePublicClient: () => ({ readContract: mocks.readContract }),
  useSwitchChain: () => ({ isPending: false, switchChain: mocks.switchChain }),
}));

vi.mock("@reown/appkit/react", () => ({
  useAppKit: () => ({ open: mocks.open }),
}));

vi.mock("../../config/env", () => ({
  runtimeConfig: { walletConfigured: true },
}));

vi.mock("../../data/swapRouter/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/swapRouter/client")>()),
  getSwapRouterCapabilities: mocks.getSwapRouterCapabilities,
  requestSwapQuotes: mocks.requestSwapQuotes,
}));

vi.mock("../../data/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/tokens")>()),
  useTokenCatalog: () => ({ data: testTokens, isPending: false }),
}));

function freshExpiry(ms = 120_000): string {
  return new Date(Date.now() + ms).toISOString();
}

function routedQuote(overrides: Partial<SwapQuote> = {}): SwapQuote {
  const intent = {
    amountIn: "25000000",
    destinationAsset: { address: nvdaBackedEthereum, chainId: 1 },
    recipient: wallet,
    slippageBps: 50,
    sourceAsset: { address: ETHEREUM_USDC, chainId: 1 },
    ...overrides.intent,
  };
  const rest: Partial<SwapQuote> = { ...overrides };
  delete rest.intent;
  return swapQuoteSchema.parse({
    amountOut: "24912500000000000000000",
    estimatedDurationSeconds: 15,
    estimatedGas: "185000",
    expiresAt: freshExpiry(),
    fees: [
      { amount: "62500", asset: { address: ETHEREUM_USDC, chainId: 1 }, kind: "protocol" },
      { amount: "4200000000000000", asset: { address: "0x0000000000000000000000000000000000000000", chainId: 1 }, kind: "network" },
    ],
    minAmountOut: "24787937500000000000000",
    providerId: "aggregator-a",
    quoteId: "quote-a",
    steps: [{
      fromAsset: { address: ETHEREUM_USDC, chainId: 1 },
      kind: "swap",
      chainId: 1,
      toAsset: { address: nvdaBackedEthereum, chainId: 1 },
    }],
    ...rest,
    intent,
  });
}

function renderPage(path = "/swap/routed") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/swap/routed" element={<RoutedSwapPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function typeAmount(value: string) {
  fireEvent.change(screen.getByLabelText("You pay amount"), { target: { value } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = { address: wallet, chainId: 1 };
  mocks.readContract.mockImplementation((call: { functionName: string }) => {
    if (call.functionName === "balanceOf") return Promise.resolve(100_000_000n);
    if (call.functionName === "decimals") return Promise.resolve(18);
    return Promise.resolve(0n);
  });
  mocks.getSwapRouterCapabilities.mockResolvedValue(swapRouterCapabilities);
  mocks.requestSwapQuotes.mockResolvedValue([routedQuote()]);
});

describe("wallet readiness", () => {
  it("shows the wallet configuration card when no Reown project is configured", async () => {
    const env = await import("../../config/env");
    const original = env.runtimeConfig.walletConfigured;
    Object.defineProperty(env.runtimeConfig, "walletConfigured", { configurable: true, value: false });
    try {
      renderPage();
      expect(await screen.findByRole("heading", { name: "Add a Reown project ID" })).toBeVisible();
    } finally {
      Object.defineProperty(env.runtimeConfig, "walletConfigured", { configurable: true, value: original });
    }
  });

  it("shows the connect card and opens the wallet modal when disconnected", () => {
    mocks.account = { address: undefined, chainId: undefined };
    renderPage();
    expect(screen.getByRole("heading", { name: "Connect your wallet to route a swap" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(mocks.open).toHaveBeenCalledWith({ view: "Connect" });
  });
});

describe("route builder", () => {
  it("defaults to the wallet chain, USDC, and the first eligible market deterministically", async () => {
    renderPage();
    expect(await screen.findByText("Backed · NVDAx · 0xAbC0…0003 on Ethereum")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Robinhood Chain" })).toHaveAttribute("aria-disabled", "true");
    expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: ETHEREUM_USDC,
      functionName: "balanceOf",
    }));
    expect(await screen.findByText(/Balance 100 USDC/)).toBeVisible();
  });

  it("preselects the exact deep-linked market without substituting another issuer", async () => {
    renderPage(`/swap/routed?chain=8453&token=${nvdaBase}`);
    expect(await screen.findByText("Backed · NVDAx · 0xAbC0…0001 on Base")).toBeVisible();
    expect(screen.queryByText(/0xAbC0…0003/)).not.toBeInTheDocument();
  });

  it("fails explicitly when a deep-linked market is unavailable instead of substituting one", async () => {
    renderPage(`/swap/routed?chain=8453&token=0x9999999999999999999999999999999999999999`);
    expect(await screen.findByRole("alert")).toHaveTextContent("not available for routed swaps");
    expect(screen.getByText(/No other issuer market was selected in its place/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Choose another market" }));
    expect(await screen.findByText("Backed · NVDAx · 0xAbC0…0003 on Ethereum")).toBeVisible();
  });

  it("re-reads the balance for the selected stablecoin and chain", async () => {
    renderPage();
    await screen.findByText(/Balance 100 USDC/);
    fireEvent.click(screen.getByRole("radio", { name: "USDT" }));
    await waitFor(() => expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      functionName: "balanceOf",
    })));
  });

  it("switches the source chain and re-reads that chain's stablecoin balance", async () => {
    renderPage();
    await screen.findByText(/Balance 100 USDC/);
    fireEvent.click(screen.getByRole("radio", { name: "Base" }));
    await waitFor(() => expect(mocks.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      functionName: "balanceOf",
    })));
  });
});

describe("quote requests", () => {
  it("requests quotes for the exact draft intent after the debounce", async () => {
    renderPage();
    typeAmount("25");
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    const call = mocks.requestSwapQuotes.mock.calls[0][0];
    expect(call.intent).toEqual({
      amountIn: "25000000",
      destinationAsset: { address: nvdaBackedEthereum, chainId: 1 },
      recipient: wallet,
      slippageBps: 50,
      sourceAsset: { address: ETHEREUM_USDC, chainId: 1 },
    });
    expect(await screen.findByText("aggregator-a", {}, { timeout: 4_000 })).toBeVisible();
    expect(screen.getByText("24912.5 NVDAx")).toBeVisible();
    expect(screen.getByText("24787.9375")).toBeVisible();
    expect(screen.getByText("185,000 gas")).toBeVisible();
    expect(screen.getByText("15s")).toBeVisible();
  });

  it("never lets an obsolete response replace the current draft", async () => {
    let resolveStale: (quotes: SwapQuote[]) => void = () => {};
    mocks.requestSwapQuotes.mockImplementationOnce(() => new Promise<SwapQuote[]>((resolve) => {
      resolveStale = resolve;
    }));
    const fresh = routedQuote({
      amountOut: "29895000000000000000000",
      intent: { amountIn: "30000000" } as SwapQuote["intent"],
      minAmountOut: "29745525000000000000000",
      quoteId: "quote-30",
    });
    mocks.requestSwapQuotes.mockImplementationOnce(() => Promise.resolve([fresh]));
    renderPage();
    typeAmount("25");
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    typeAmount("30");
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(await screen.findByText("29895 NVDAx")).toBeVisible();
    resolveStale([routedQuote({ providerId: "late-provider", quoteId: "quote-late" })]);
    await waitFor(() => expect(screen.queryByText("late-provider")).not.toBeInTheDocument());
    expect(screen.getByText("29895 NVDAx")).toBeVisible();
  });

  it("shows a loading state while the first quotes are requested", async () => {
    let resolveQuotes: (quotes: SwapQuote[]) => void = () => {};
    mocks.requestSwapQuotes.mockImplementationOnce(() => new Promise<SwapQuote[]>((resolve) => {
      resolveQuotes = resolve;
    }));
    renderPage();
    typeAmount("25");
    expect(await screen.findByText("Requesting route quotes…")).toBeVisible();
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(1));
    resolveQuotes([routedQuote()]);
    expect(await screen.findByText("aggregator-a", {}, { timeout: 4_000 })).toBeVisible();
  });

  it("shows the no-route state for empty and NO_QUOTES responses", async () => {
    mocks.requestSwapQuotes.mockResolvedValue([]);
    renderPage();
    typeAmount("25");
    expect(await screen.findByRole("heading", { name: "No route available" }, { timeout: 4_000 })).toBeVisible();
  });

  it("shows the no-route state when the router rejects the route", async () => {
    mocks.requestSwapQuotes.mockRejectedValue(new SwapRouterApiError("UNSUPPORTED_ROUTE", "none", 422));
    renderPage();
    typeAmount("25");
    expect(await screen.findByRole("heading", { name: "No route available" }, { timeout: 4_000 })).toBeVisible();
  });

  it("shows quote failures as an actionable error", async () => {
    mocks.requestSwapQuotes.mockRejectedValue(new SwapRouterApiError("NETWORK_ERROR", "down", 0));
    renderPage();
    typeAmount("25");
    expect(await screen.findByRole("alert")).toHaveTextContent(/unreachable/i);
  });

  it("auto-refreshes quotes when the earliest expiry passes", async () => {
    mocks.requestSwapQuotes.mockResolvedValue([routedQuote({ expiresAt: freshExpiry(1_200) })]);
    renderPage();
    typeAmount("25");
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(2), { timeout: 5_000 });
  });

  it("warns about partial provider coverage from capabilities", async () => {
    mocks.getSwapRouterCapabilities.mockResolvedValue(partialProviderCapabilities);
    renderPage();
    typeAmount("25");
    expect(await screen.findByText("Partial provider coverage")).toBeVisible();
    expect(screen.getByText(/aggregator is degraded/)).toBeVisible();
  });

  it("keeps the builder usable when capabilities fail to load", async () => {
    mocks.getSwapRouterCapabilities.mockRejectedValue(new SwapRouterApiError("NETWORK_ERROR", "down", 0));
    renderPage();
    expect(await screen.findByText("Router capabilities unavailable", {}, { timeout: 4_000 })).toBeVisible();
    typeAmount("25");
    expect(await screen.findByText("aggregator-a", {}, { timeout: 4_000 })).toBeVisible();
  });
});

describe("route review", () => {
  it("reviews the selected quote with its full financial identity", async () => {
    renderPage();
    typeAmount("25");
    await screen.findByText("aggregator-a", {}, { timeout: 4_000 });
    await screen.findByText(/Balance 100 USDC/);
    fireEvent.click(screen.getByRole("button", { name: "Review route" }));
    const review = await screen.findByRole("status", { name: "Routed swap review" }, { timeout: 4_000 });
    expect(review).toHaveTextContent("Review route via aggregator-a");
    expect(review).toHaveTextContent("25 USDC on Ethereum · 0xA0b8…eB48");
    expect(review).toHaveTextContent("24787.9375 NVDAx on Ethereum");
    expect(review).toHaveTextContent("24912.5 NVDAx");
    expect(review).toHaveTextContent("0xAbC0…0003 on Ethereum");
    expect(review).toHaveTextContent("Swap USDC for NVDAx on Ethereum");
    expect(review).toHaveTextContent("0.0625 USDC protocol + 0.0042 ETH network");
    expect(review).toHaveTextContent("Fresh for");
    expect(review).toHaveTextContent("Same-chain route: your wallet transacts only on Ethereum.");
    expect(review).toHaveTextContent("follow-up release");
  });

  it("keeps review blocked until the wallet is on the source chain", async () => {
    mocks.account = { address: wallet, chainId: 56 };
    renderPage();
    typeAmount("25");
    await screen.findByText("aggregator-a", {}, { timeout: 4_000 });
    // The page follows the wallet chain until the user picks one explicitly.
    fireEvent.click(screen.getByRole("radio", { name: "Ethereum" }));
    await screen.findByText("Switch your wallet to Ethereum to review this route", {}, { timeout: 4_000 });
    expect(screen.getByRole("button", { name: "Review route" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Switch to Ethereum" }));
    expect(mocks.switchChain).toHaveBeenCalledWith({ chainId: 1 });
  });

  it("blocks review while the balance is insufficient", async () => {
    mocks.readContract.mockImplementation((call: { functionName: string }) => (
      call.functionName === "balanceOf" ? Promise.resolve(1n) : Promise.resolve(18)
    ));
    renderPage();
    typeAmount("25");
    await screen.findByText("aggregator-a", {}, { timeout: 4_000 });
    await screen.findByText("Insufficient stablecoin balance for this route", {}, { timeout: 4_000 });
  });

  it("returns to editing and invalidates the executable state when the amount changes", async () => {
    renderPage();
    typeAmount("25");
    await screen.findByText("aggregator-a", {}, { timeout: 4_000 });
    await screen.findByText(/Balance 100 USDC/);
    fireEvent.click(screen.getByRole("button", { name: "Review route" }));
    await screen.findByRole("status", { name: "Routed swap review" }, { timeout: 4_000 });
    typeAmount("40");
    // Editing the amount tears down the executable state immediately.
    expect(screen.queryByRole("status", { name: "Routed swap review" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.requestSwapQuotes).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    const refreshedButton = await screen.findByRole("button", { name: "Review route" }, { timeout: 4_000 });
    expect(refreshedButton).toBeEnabled();
  });

  it("requires a fresh review when a different route alternative is selected", async () => {
    mocks.requestSwapQuotes.mockResolvedValue([
      routedQuote(),
      routedQuote({
        amountOut: "24800000000000000000000",
        minAmountOut: "24676000000000000000000",
        providerId: "zerox",
        quoteId: "quote-b",
      }),
    ]);
    renderPage();
    typeAmount("25");
    await screen.findByText("zerox");
    fireEvent.click(screen.getByRole("button", { name: "Review route" }));
    await screen.findByRole("status", { name: "Routed swap review" }, { timeout: 4_000 });
    fireEvent.click(screen.getByRole("button", { name: /zerox/ }));
    expect(screen.queryByRole("status", { name: "Routed swap review" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review route" })).toBeEnabled();
  });
});

describe("accessibility", () => {
  it("keeps the quote comparison in a polite live region with labelled alternatives", async () => {
    renderPage();
    const comparison = await screen.findByRole("complementary");
    expect(comparison).toHaveAttribute("aria-live", "polite");
    typeAmount("25");
    await screen.findByText("aggregator-a", {}, { timeout: 4_000 });
    expect(screen.getByRole("button", { name: /aggregator-a/ })).toBeInTheDocument();
  });
});
