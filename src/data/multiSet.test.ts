import type { Address } from "viem";

import { poolQueryKeys, setQueryKeys } from "./queryKeys";
import type { Pool, PoolState } from "./rfq/deposits";
import { requestDepositQuote, requestFirmDepositQuote } from "./rfq/deposits";
import { requestSwapQuote, requestFirmSwapQuote } from "./rfq/swaps";
import { requestWithdrawalQuote, requestFirmWithdrawalQuote } from "./rfq/withdrawals";
import { getPools, type PoolSummary } from "./rfq/pools";
import { resolveSet } from "./sets";
import {
  readWalletPoolPosition,
  walletPoolPositionQueryKey,
  type PoolPositionClient,
  type PoolPositionConnection,
} from "./chain/poolPosition";

const poolAddressA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as Address;
const poolAddressB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" as Address;
const lpTokenA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1" as Address;
const lpTokenB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1" as Address;
const assetA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2" as Address;
const assetB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2" as Address;
const account = "0x0000000000000000000000000000000000000001" as Address;
const at = "2026-07-21T12:00:00.000Z";
const until = "2026-07-21T12:00:10.000Z";

const SET_A = "set-alpha-bsc-testnet";
const SET_B = "set-beta-bsc-testnet";

function poolFixture(id: string, contractAddress: Address, lp: Address, asset: Address): Pool {
  return {
    id,
    chain: { id: 97, name: "BSC Testnet" },
    contract: { address: contractAddress },
    lpToken: { symbol: `LP-${id}`, decimals: 18, address: lp },
    quotePolicy: { allowedLockDays: [0, 30, 90] },
    assets: [{ address: asset, decimals: 18, id: `ASSET-${id}`, index: 0, symbol: `A-${id}`, weight: 1 }],
  };
}

function poolStateFixture(poolId: string, poolAddress: Address, blockNumber: string): PoolState {
  return {
    poolId,
    chainId: 97,
    poolAddress,
    blockNumber,
    blockTimestamp: at,
    trading: { paused: false, deposits: "available" },
    totalValueUsd: "1000000",
    totalSupply: { amount: "1000", atomicAmount: "1000000000000000000000", decimals: 18 },
    assets: [{
      asset: `ASSET-${poolId}`, amount: "1000", atomicAmount: "1000000000000000000000", decimals: 18,
      index: 0, recordedAtomicBalance: "1000000000000000000000", actualAtomicBalance: "1000000000000000000000",
      balanceStatus: "synced", multiplier: "1", valueUsd: "1000000",
      market: { bidUsd: "1", askUsd: "1", observedAt: at },
    }],
  };
}

function summaryFixture(id: string, contractAddress: Address, lp: Address, asset: Address): PoolSummary {
  return {
    id,
    chain: { id: 97, name: "BSC Testnet" },
    contract: { address: contractAddress },
    lpToken: { symbol: `LP-${id}`, decimals: 18, address: lp },
    assets: [{ id: `ASSET-${id}`, symbol: `A-${id}`, address: asset, decimals: 18, weight: 1, index: 0 }],
  };
}

const poolA = poolFixture(SET_A, poolAddressA, lpTokenA, assetA);
const poolB = poolFixture(SET_B, poolAddressB, lpTokenB, assetB);
const stateA = poolStateFixture(SET_A, poolAddressA, "100");
const stateB = poolStateFixture(SET_B, poolAddressB, "200");

function response(json: unknown, status = 200) {
  return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  if (!init || typeof init.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function depositQuoteBody(poolId: string) {
  return {
    indicativeQuoteId: `indicative-${poolId}`,
    quoteType: "indicative",
    operation: "deposit",
    pricedAt: at,
    validUntil: until,
    lockDays: 0,
    stateSnapshot: { chainId: 97, poolAddress: poolId === SET_A ? poolAddressA : poolAddressB, tradingPaused: false },
    marketSnapshot: [{ asset: `ASSET-${poolId}`, bidUsd: "1", askUsd: "1" }],
    deposits: [{ asset: `ASSET-${poolId}`, amount: "10", atomicAmount: "10000000000000000000", decimals: 18 }],
    orderedAtomicAmounts: ["10000000000000000000"],
    output: { asset: `LP-${poolId}`, amount: "9.9", atomicAmount: "9900000000000000000", decimals: 18 },
    warnings: [],
  };
}

function swapQuoteBody(poolId: string) {
  const poolAddress = poolId === SET_A ? poolAddressA : poolAddressB;
  return {
    indicativeQuoteId: `swap-${poolId}`,
    quoteType: "indicative",
    operation: "swap",
    intent: "exact-input",
    pricedAt: at,
    validUntil: until,
    stateSnapshot: {
      poolId, chainId: 97, poolAddress, blockNumber: "100",
      blockHash: `0x${"1".repeat(64)}`, blockTimestamp: at, tradingPaused: false,
    },
    marketSnapshot: [
      { asset: `ASSET-${poolId}`, bidUsd: "1", askUsd: "1", observedAt: at, provider: "test", providerSymbol: "TEST", quoteCurrency: "USD", secondarySession: "ref", sequence: null, topAskQuantity: null, topBidQuantity: null, underlyingSession: null },
    ],
    input: { asset: `ASSET-${poolId}`, amount: "10", atomicAmount: "10000000000000000000", decimals: 18 },
    output: { asset: `ASSET-${poolId}`, amount: "9.9", atomicAmount: "9900000000000000000", decimals: 18 },
    economics: {
      inputValueUsd: "10", outputValueUsd: "9.9", effectiveRate: "0.99", fairRate: "1",
      priceImpactBps: 10, fee: { type: "curve-input-adjustment", bps: 10, asset: `ASSET-${poolId}`, indicativeAtomicAmount: "10000000000000000" },
    },
    pricing: {
      model: "setwise-inventory-v1.1", k: "0.5",
      policy: { minNotionalUsd: "1", maxNotionalUsd: "100000", maxMarketAgeMs: 5000, maxSpreadBps: 100, maxVenueDivergenceBps: 500, maxVenuePriceImpactBps: 300, minDexLiquidityUsd: "1000", reserveBps: 100, hedgeMarginBps: 10, maxInventoryPremiumBps: 0, requireExternalLiquidity: false },
      inventoryBefore: "1", inventoryAfterLowerBound: "0.9",
      constraints: { curveOutputAtomic: "9900000000000000000", fairValueOutputAtomic: "9900000000000000000", externalGuardOutputAtomic: null },
      venues: [],
    },
    warnings: [],
  };
}

function withdrawalQuoteBody(poolId: string) {
  return {
    indicativeQuoteId: `withdraw-${poolId}`,
    quoteType: "indicative",
    operation: "withdrawal",
    pricedAt: at,
    validUntil: until,
    stateSnapshot: { poolId, chainId: 97, poolAddress: poolId === SET_A ? poolAddressA : poolAddressB, tradingPaused: false },
    marketSnapshot: [{ asset: `ASSET-${poolId}`, bidUsd: "1", askUsd: "1" }],
    input: { asset: `LP-${poolId}`, amount: "1", atomicAmount: "1000000000000000000", decimals: 18 },
    outputs: [{ asset: `ASSET-${poolId}`, amount: "0.99", atomicAmount: "990000000000000000", decimals: 18 }],
    mode: "proportional",
    execution: "direct-onchain",
    warnings: [],
  };
}

function mockClient(results: readonly unknown[], nativeBalance = 0n) {
  return {
    chain: { id: 97 },
    getBalance: vi.fn().mockResolvedValue(nativeBalance),
    multicall: vi.fn().mockResolvedValue(results),
  } as unknown as PoolPositionClient;
}

const connected: PoolPositionConnection = { account, chainId: 97, status: "connected" };

describe("two-Set isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("discovery", () => {
    it("discovers both Sets from the registry without filtering", async () => {
      const fetchMock = vi.fn().mockResolvedValue(response({
        pools: [
          summaryFixture(SET_A, poolAddressA, lpTokenA, assetA),
          summaryFixture(SET_B, poolAddressB, lpTokenB, assetB),
        ],
      }));
      vi.stubGlobal("fetch", fetchMock);

      const pools = await getPools();

      expect(pools).toHaveLength(2);
      expect(pools.map((p) => p.id)).toEqual([SET_A, SET_B]);
    });

    it("resolves each Set independently from the same registry", () => {
      const pools = [
        summaryFixture(SET_A, poolAddressA, lpTokenA, assetA),
        summaryFixture(SET_B, poolAddressB, lpTokenB, assetB),
      ];

      const resolutionA = resolveSet(SET_A, pools, 97);
      const resolutionB = resolveSet(SET_B, pools, 97);

      expect(resolutionA.status).toBe("ready");
      expect(resolutionB.status).toBe("ready");
      if (resolutionA.status === "ready" && resolutionB.status === "ready") {
        expect(resolutionA.definition.id).toBe(SET_A);
        expect(resolutionB.definition.id).toBe(SET_B);
        expect(resolutionA.definition.pool.contract.address).toBe(poolAddressA);
        expect(resolutionB.definition.pool.contract.address).toBe(poolAddressB);
      }
    });
  });

  describe("query keys", () => {
    it("produces distinct discovery and state keys per Set", () => {
      expect(poolQueryKeys.discovery(SET_A)).not.toEqual(poolQueryKeys.discovery(SET_B));
      expect(poolQueryKeys.state(SET_A)).not.toEqual(poolQueryKeys.state(SET_B));
    });

    it("produces distinct Set-scoped keys per Set", () => {
      expect(setQueryKeys.detail(SET_A)).not.toEqual(setQueryKeys.detail(SET_B));
      expect(setQueryKeys.state(SET_A)).not.toEqual(setQueryKeys.state(SET_B));
    });

    it("produces distinct wallet-position keys per Set", () => {
      const keyA = walletPoolPositionQueryKey({
        connection: connected, pool: poolA, poolState: stateA, requestedAccount: account,
      });
      const keyB = walletPoolPositionQueryKey({
        connection: connected, pool: poolB, poolState: stateB, requestedAccount: account,
      });

      expect(keyA).not.toEqual(keyB);
      expect(keyA[1]).toBe(SET_A);
      expect(keyB[1]).toBe(SET_B);
    });
  });

  describe("quote requests", () => {
    it("sends Set A poolId on deposit quotes and Set B poolId on its own", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(depositQuoteBody(SET_A)))
        .mockResolvedValueOnce(response(depositQuoteBody(SET_B)));
      vi.stubGlobal("fetch", fetchMock);

      await requestDepositQuote(SET_A, [{ asset: "ASSET", amount: "10" }], 0);
      await requestDepositQuote(SET_B, [{ asset: "ASSET", amount: "10" }], 0);

      const bodyA = requestBody(fetchMock, 0);
      const bodyB = requestBody(fetchMock, 1);
      expect(bodyA.poolId).toBe(SET_A);
      expect(bodyB.poolId).toBe(SET_B);
      expect(bodyA.poolId).not.toBe(bodyB.poolId);
    });

    it("sends the correct poolId on firm deposit quotes for each Set", async () => {
      const firmBody = (poolId: string) => ({
        firmQuoteId: `0x${"1".repeat(64)}`,
        quoteType: "firm",
        status: "executable",
        operation: "deposit",
        mode: "single-asset",
        mustSubmitBy: until,
        investor: account,
        lockDays: 0,
        orderedAtomicAmounts: ["10000000000000000000"],
        shares: { asset: `LP-${poolId}`, amount: "9.9", atomicAmount: "9900000000000000000", decimals: 18 },
        transaction: { chainId: 97, to: poolId === SET_A ? poolAddressA : poolAddressB, data: "0x1234", value: "0", method: "depositSingleAsset" },
        requirements: { sender: account, approvals: [] },
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(firmBody(SET_A)))
        .mockResolvedValueOnce(response(firmBody(SET_B)));
      vi.stubGlobal("fetch", fetchMock);

      await requestFirmDepositQuote({ amounts: [{ asset: "A", amount: "10" }], idempotencyKey: "a", investor: account, lockDays: 0, mode: "single-asset", poolId: SET_A });
      await requestFirmDepositQuote({ amounts: [{ asset: "A", amount: "10" }], idempotencyKey: "b", investor: account, lockDays: 0, mode: "single-asset", poolId: SET_B });

      const bodyA = requestBody(fetchMock, 0);
      const bodyB = requestBody(fetchMock, 1);
      expect(bodyA.poolId).toBe(SET_A);
      expect(bodyB.poolId).toBe(SET_B);
    });

    it("sends the correct poolId on swap quotes for each Set", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(swapQuoteBody(SET_A)))
        .mockResolvedValueOnce(response(swapQuoteBody(SET_B)));
      vi.stubGlobal("fetch", fetchMock);

      await requestSwapQuote({ inputAmount: "10", inputAsset: "A", outputAsset: "B", poolId: SET_A });
      await requestSwapQuote({ inputAmount: "10", inputAsset: "A", outputAsset: "B", poolId: SET_B });

      const bodyA = requestBody(fetchMock, 0);
      const bodyB = requestBody(fetchMock, 1);
      expect(bodyA.poolId).toBe(SET_A);
      expect(bodyB.poolId).toBe(SET_B);
    });

    it("sends the correct poolId on withdrawal quotes for each Set", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(withdrawalQuoteBody(SET_A)))
        .mockResolvedValueOnce(response(withdrawalQuoteBody(SET_B)));
      vi.stubGlobal("fetch", fetchMock);

      await requestWithdrawalQuote({ poolId: SET_A, poolTokenAmount: "1" });
      await requestWithdrawalQuote({ poolId: SET_B, poolTokenAmount: "1" });

      const bodyA = requestBody(fetchMock, 0);
      const bodyB = requestBody(fetchMock, 1);
      expect(bodyA.poolId).toBe(SET_A);
      expect(bodyB.poolId).toBe(SET_B);
    });
  });

  describe("wallet position isolation", () => {
    it("reads Set A and Set B positions from their own pool contracts", async () => {
      const clientA = mockClient([10n, 5n, [0n, 0n], false], 1n);
      const clientB = mockClient([20n, 8n, [0n, 0n], false], 2n);

      const resultA = await readWalletPoolPosition({
        client: clientA, connection: connected, pool: poolA, poolState: stateA, requestedAccount: account,
      });
      const resultB = await readWalletPoolPosition({
        client: clientB, connection: connected, pool: poolB, poolState: stateB, requestedAccount: account,
      });

      expect(resultA.status).toBe("ready");
      expect(resultB.status).toBe("ready");
      if (resultA.status === "ready" && resultB.status === "ready") {
        expect(resultA.position.shares.unlocked).toBe(5n);
        expect(resultB.position.shares.unlocked).toBe(8n);
        expect(resultA.position.nativeBalance).toBe(1n);
        expect(resultB.position.nativeBalance).toBe(2n);
        expect(resultA.position.chainId).toBe(97);
        expect(resultB.position.chainId).toBe(97);
      }

      type MulticallArgs = { contracts: readonly { address: Address }[] };
      const multicallA = (clientA as unknown as { multicall: ReturnType<typeof vi.fn> }).multicall;
      const multicallB = (clientB as unknown as { multicall: ReturnType<typeof vi.fn> }).multicall;
      const contractsA = (multicallA.mock.calls[0]?.[0] as MulticallArgs | undefined)?.contracts;
      const contractsB = (multicallB.mock.calls[0]?.[0] as MulticallArgs | undefined)?.contracts;
      expect(contractsA?.[0]?.address).toBe(assetA);
      expect(contractsB?.[0]?.address).toBe(assetB);
    });

    it("rejects a pool-state snapshot that belongs to a different Set", async () => {
      const client = mockClient([]);
      await expect(readWalletPoolPosition({
        client,
        connection: connected,
        pool: poolA,
        poolState: stateB,
        requestedAccount: account,
      })).rejects.toThrow(/snapshot does not match/);
    });
  });

  describe("firm quote cross-contamination guard", () => {
    it("sends distinct firm swap quote poolIds for each Set", async () => {
      const firmSwap = (poolId: string) => ({
        firmQuoteId: `0x${"1".repeat(64)}`,
        quoteType: "firm",
        status: "executable",
        operation: "swap",
        intent: "exact-input",
        createdAt: at,
        mustSubmitBy: until,
        executionDeadline: "1784462410",
        stateSnapshot: {
          poolId, chainId: 97, poolAddress: poolId === SET_A ? poolAddressA : poolAddressB,
          blockNumber: "100", blockHash: `0x${"2".repeat(64)}`, blockTimestamp: "1784462400",
        },
        input: { asset: "A", amount: "10", atomicAmount: "10000000000000000000", decimals: 18 },
        output: { asset: "B", amount: "9.9", atomicAmount: "9900000000000000000", decimals: 18 },
        venues: [],
        guard: { packedDeadline: "1", offchainInputBalance: "1", offchainOutputBalance: "1", inputTolerancePpm: "5000", outputTolerancePpm: "5000", maximumInputBalance: "1", minimumOutputBalance: "1" },
        authorization: {
          signer: account, digest: `0x${"1".repeat(64)}`, signature: "0x1234",
          typedData: {
            domain: { name: "SetwisePool", version: "2.0.0", chainId: 97, verifyingContract: poolId === SET_A ? poolAddressA : poolAddressB },
            primaryType: "SwapQuote",
            types: { SwapQuote: [{ name: "payer", type: "address" }] },
            message: { payer: account, inputAsset: assetA, outputAsset: assetB, inputAmount: "10000000000000000000", outputAmount: "9900000000000000000", quoteId: `0x${"1".repeat(64)}`, deadline: "1", recipient: account },
          },
        },
        transaction: { chainId: 97, to: poolId === SET_A ? poolAddressA : poolAddressB, data: "0x1234", value: "0", method: "swapExactAssetForAsset" },
        requirements: { sender: account, approvals: [] },
        warnings: [],
        persisted: true,
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(firmSwap(SET_A)))
        .mockResolvedValueOnce(response(firmSwap(SET_B)));
      vi.stubGlobal("fetch", fetchMock);

      await requestFirmSwapQuote({ idempotencyKey: "a", inputAmount: "10", inputAsset: "A", inputNative: false, outputAsset: "B", outputNative: false, payer: account, poolId: SET_A, recipient: account });
      await requestFirmSwapQuote({ idempotencyKey: "b", inputAmount: "10", inputAsset: "A", inputNative: false, outputAsset: "B", outputNative: false, payer: account, poolId: SET_B, recipient: account });

      const bodyA = requestBody(fetchMock, 0);
      const bodyB = requestBody(fetchMock, 1);
      expect(bodyA.poolId).toBe(SET_A);
      expect(bodyB.poolId).toBe(SET_B);
    });

    it("sends distinct firm withdrawal quote poolIds for each Set", async () => {
      const firmWithdrawal = (poolId: string) => ({
        firmQuoteId: "firm-1",
        quoteType: "firm",
        status: "executable",
        operation: "withdrawal",
        mode: "single-asset",
        mustSubmitBy: until,
        investor: account,
        shares: { asset: `LP-${poolId}`, amount: "1", atomicAmount: "1000000000000000000", decimals: 18 },
        output: { asset: `ASSET-${poolId}`, amount: "0.99", atomicAmount: "990000000000000000", decimals: 18 },
        receiveNative: false,
        transaction: { chainId: 97, to: poolId === SET_A ? poolAddressA : poolAddressB, data: "0x1234", value: "0", method: "withdrawSingleAsset" },
        requirements: { sender: account, minimumPoolTokenBalance: "1000000000000000000" },
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(firmWithdrawal(SET_A)))
        .mockResolvedValueOnce(response(firmWithdrawal(SET_B)));
      vi.stubGlobal("fetch", fetchMock);

      await requestFirmWithdrawalQuote({ idempotencyKey: "a", investor: account, outputAsset: "A", poolId: SET_A, poolTokenAmount: "1", receiveNative: false });
      await requestFirmWithdrawalQuote({ idempotencyKey: "b", investor: account, outputAsset: "B", poolId: SET_B, poolTokenAmount: "1", receiveNative: false });

      const bodyA = requestBody(fetchMock, 0);
      const bodyB = requestBody(fetchMock, 1);
      expect(bodyA.poolId).toBe(SET_A);
      expect(bodyB.poolId).toBe(SET_B);
    });
  });
});
