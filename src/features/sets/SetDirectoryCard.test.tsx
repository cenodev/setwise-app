import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { isStaleSnapshot, SetDirectoryCard } from "./SetDirectoryCard";
import type { SetDirectoryState } from "../../data/setDirectory";
import type { PoolState } from "../../data/rfq/deposits";
import type { SetDefinition } from "../../data/sets";
import type { TokenMetadataIndex } from "../../data/tokens";

const poolAddress = "0x1111111111111111111111111111111111111111";
const lpAddress = "0x2222222222222222222222222222222222222222";
const usdtAddress = "0x3333333333333333333333333333333333333333";
const bnbAddress = "0x4444444444444444444444444444444444444444";

function definition(id: string, chainId = 97): SetDefinition {
  return {
    chainId,
    chainName: chainId === 97 ? "BSC Testnet" : "Ethereum",
    id,
    supported: chainId === 97,
    pool: {
      id,
      display: {
        category: "Index",
        description: `Description for ${id}`,
        name: `Set ${id}`,
        sortOrder: 0,
      },
      chain: { id: chainId, name: chainId === 97 ? "BSC Testnet" : "Ethereum" },
      contract: { address: poolAddress },
      lpToken: { symbol: "SETWISE", decimals: 18, address: lpAddress },
      assets: [
        { id: "USDT", symbol: "mUSDT", address: usdtAddress, decimals: 6, weight: 50, index: 0 },
        { id: "BNB", symbol: "WBNB", address: bnbAddress, decimals: 18, weight: 50, index: 1 },
      ],
    },
  };
}

function state(poolId: string, overrides?: Partial<PoolState>): PoolState {
  return {
    poolId,
    chainId: 97,
    poolAddress,
    blockNumber: "12345",
    blockTimestamp: new Date().toISOString(),
    trading: { paused: false, deposits: "available" },
    totalValueUsd: "1234567.89",
    totalSupply: { amount: "1000000", atomicAmount: "1000000000000000000000000", decimals: 18 },
    assets: [
      {
        asset: "USDT", amount: "500000", atomicAmount: "500000000000", decimals: 6,
        index: 0, recordedAtomicBalance: "500000000000", actualAtomicBalance: "500000000000",
        balanceStatus: "synced", multiplier: "1", valueUsd: "500000",
        market: { bidUsd: "0.999", askUsd: "1.001", observedAt: new Date().toISOString() },
      },
      {
        asset: "BNB", amount: "1000", atomicAmount: "1000000000000000000000", decimals: 18,
        index: 1, recordedAtomicBalance: "1000000000000000000000", actualAtomicBalance: "1000000000000000000000",
        balanceStatus: "synced", multiplier: "1", valueUsd: "734567.89",
        market: { bidUsd: "734", askUsd: "735", observedAt: new Date().toISOString() },
      },
    ],
    ...overrides,
  };
}

function ready(poolId: string, overrides?: Partial<PoolState>): SetDirectoryState {
  return { poolId, state: state(poolId, overrides), status: "ready" };
}

function renderCard(input: {
  loading?: boolean;
  onRetry?: () => void;
  result?: SetDirectoryState;
  set?: SetDefinition;
  tokenIndex?: TokenMetadataIndex;
} = {}) {
  return render(
    <MemoryRouter>
      <SetDirectoryCard
        loading={input.loading ?? false}
        onRetry={input.onRetry ?? vi.fn()}
        result={"result" in input ? input.result : ready("alpha-set")}
        set={input.set ?? definition("alpha-set")}
        tokenIndex={input.tokenIndex}
      />
    </MemoryRouter>,
  );
}

describe("SetDirectoryCard", () => {
  it("renders presentation metadata, internal id, and constituent assets", () => {
    renderCard();

    expect(screen.getByRole("heading", { name: "Set alpha-set" })).toBeVisible();
    expect(screen.getByText("Description for alpha-set")).toBeVisible();
    expect(screen.getByText("alpha-set")).toBeVisible();
    expect(screen.getByText("Index")).toBeVisible();
    expect(screen.getByRole("list", { name: "Set alpha-set constituents" })).toBeVisible();
    expect(screen.getByText("mUSDT")).toBeVisible();
    expect(screen.getByText("WBNB")).toBeVisible();
  });

  it("shows live TVL, snapshot, and trading status", () => {
    renderCard();
    expect(screen.getByText("$1234567.89")).toBeVisible();
    expect(screen.getByText("Set TVL")).toBeVisible();
    expect(screen.getByText("Snapshot")).toBeVisible();
    expect(screen.getByText("Trading")).toBeVisible();
  });

  it("shows loading and isolated error states with retry", () => {
    const retry = vi.fn();
    const first = renderCard({ loading: true, result: undefined });
    expect(screen.getByText("Loading live state…")).toBeVisible();
    first.unmount();

    renderCard({
      onRetry: retry,
      result: { error: new Error("state exploded"), poolId: "alpha-set", status: "error" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("state exploded");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows paused and stale state badges", () => {
    const paused = renderCard({ result: ready("alpha-set", { trading: { paused: true, deposits: "paused" } }) });
    expect(screen.getByText("Paused")).toBeVisible();
    paused.unmount();

    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    renderCard({ result: ready("alpha-set", { blockTimestamp: oldTimestamp }) });
    expect(screen.getByText("Stale")).toBeVisible();
  });

  it("shows unsupported-chain context and hides swap", () => {
    renderCard({
      result: { poolId: "eth-set", status: "unsupported-chain" },
      set: definition("eth-set", 1),
    });
    expect(screen.getByText(/not supported in this environment/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Swap" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Set" })).toHaveAttribute("href", "/sets/eth-set/overview");
  });

  it("links actions to the internal Set id and distinguishes liquidity definitions", () => {
    renderCard();
    expect(screen.getByRole("link", { name: "View Set" })).toHaveAttribute("href", "/sets/alpha-set/overview");
    expect(screen.getByRole("link", { name: "Swap" })).toHaveAttribute("href", "/swap?set=alpha-set");
    expect(screen.getByText(/not external DEX liquidity/i)).toBeVisible();
  });

  it("uses token metadata logos when available", () => {
    const tokenIndex = new Map([
      [`97:${usdtAddress.toLowerCase()}`, {
        address: usdtAddress, chainId: 97, name: "Mock USDT", symbol: "mUSDT",
        logoURI: "https://example.com/usdt.png",
      }],
    ]) as unknown as TokenMetadataIndex;
    renderCard({ tokenIndex });
    expect(screen.getByAltText("")).toHaveAttribute("src", "https://example.com/usdt.png");
  });
});

describe("isStaleSnapshot", () => {
  it("distinguishes recent, old, and invalid timestamps", () => {
    const now = Date.now();
    expect(isStaleSnapshot(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(isStaleSnapshot(new Date(now - 6 * 60_000).toISOString(), now)).toBe(true);
    expect(isStaleSnapshot("not-a-date")).toBe(true);
  });
});
