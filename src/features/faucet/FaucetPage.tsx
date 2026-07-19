import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Address, Hash } from "viem";
import { isAddressEqual } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { requiredChainId } from "../../config/chains";
import { bscTestnetDeployment, type FaucetTokenMetadata } from "../../config/deployment";
import { runtimeConfig } from "../../config/env";
import { erc20Abi, faucetAbi } from "../../data/chain/abis";
import { formatTokenAmount } from "../../lib/decimal";
import { truncateAddress } from "../../lib/format";
import { FaucetAvailabilityNotice, FaucetTransactionStatus, type FaucetTransactionStage } from "./FaucetStatus";
import { faucetAvailability, relativeTime } from "./model";
import { executeFaucetClaim } from "./transaction";

type FaucetAsset = FaucetTokenMetadata & {
  claimAmount: bigint;
  inventory: bigint;
  walletBalance: bigint;
};

type FaucetState = {
  assets: FaucetAsset[];
  cooldown: bigint;
  nextEligibleAt: bigint;
  paused: boolean;
};

type TransactionState = { stage: FaucetTransactionStage; hash?: Hash; error?: string };

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function currentTimestamp(): number {
  return Date.now();
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown wallet or contract error";
  return error.message.split("\n")[0] ?? error.message;
}

function wasRejected(error: unknown): boolean {
  const candidate = error as { code?: number; message?: string };
  const message = candidate?.message?.toLowerCase() ?? "";
  return candidate?.code === 4001 || message.includes("user rejected") || message.includes("user denied");
}

function metadataFor(token: Address): FaucetTokenMetadata {
  const metadata = bscTestnetDeployment.tokens.find((item) => isAddressEqual(item.address, token));
  if (!metadata) throw new Error(`Faucet token ${token} is missing from the deployment manifest`);
  return metadata;
}

async function copyAddress(address: Address): Promise<void> {
  await navigator.clipboard.writeText(address);
}

async function watchAsset(asset: FaucetTokenMetadata): Promise<void> {
  const ethereum = (window as unknown as {
    ethereum?: { request: (input: { method: string; params: unknown }) => Promise<unknown> };
  }).ethereum;
  if (!ethereum) throw new Error("This wallet does not expose an add-token action");
  await ethereum.request({
    method: "wallet_watchAsset",
    params: { type: "ERC20", options: { address: asset.address, decimals: asset.decimals, symbol: asset.symbol } },
  });
}

export function FaucetPage() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: requiredChainId });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const online = useOnline();
  const [now, setNow] = useState(currentTimestamp);
  const [transaction, setTransaction] = useState<TransactionState>({ stage: "idle" });
  const [copied, setCopied] = useState<Address | null>(null);
  const [walletAssetMessage, setWalletAssetMessage] = useState<string | null>(null);

  const stateQuery = useQuery({
    queryKey: ["setwise-faucet", bscTestnetDeployment.faucet.address, address],
    enabled: Boolean(address && publicClient),
    queryFn: async (): Promise<FaucetState> => {
      if (!address || !publicClient) throw new Error("Wallet client is unavailable");
      const faucetAddress = bscTestnetDeployment.faucet.address;
      const [assetCount, cooldown, nextEligibleAt, paused] = await Promise.all([
        publicClient.readContract({ address: faucetAddress, abi: faucetAbi, functionName: "assetCount" }),
        publicClient.readContract({ address: faucetAddress, abi: faucetAbi, functionName: "cooldown" }),
        publicClient.readContract({ address: faucetAddress, abi: faucetAbi, functionName: "nextEligibleAt", args: [address] }),
        publicClient.readContract({ address: faucetAddress, abi: faucetAbi, functionName: "paused" }),
      ]);
      const assets = await Promise.all(Array.from({ length: Number(assetCount) }, async (_, index) => {
        const [token, claimAmount, inventory] = await publicClient.readContract({
          address: faucetAddress,
          abi: faucetAbi,
          functionName: "assetAt",
          args: [BigInt(index)],
        });
        const metadata = metadataFor(token);
        const walletBalance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        return { ...metadata, claimAmount, inventory, walletBalance };
      }));
      if (assets.length !== bscTestnetDeployment.tokens.length) {
        throw new Error("On-chain faucet assets do not match the checked-in deployment manifest");
      }
      return { assets, cooldown, nextEligibleAt, paused };
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!stateQuery.data?.nextEligibleAt) return;
    const timer = window.setInterval(() => setNow(currentTimestamp()), 1_000);
    return () => window.clearInterval(timer);
  }, [stateQuery.data?.nextEligibleAt]);

  const hasSufficientInventory = stateQuery.data?.assets.every((asset) => asset.inventory >= asset.claimAmount) ?? false;
  const availability = useMemo(() => faucetAvailability({
    connected: isConnected,
    correctChain: chainId === requiredChainId,
    online,
    paused: stateQuery.data?.paused ?? false,
    nextEligibleAt: stateQuery.data?.nextEligibleAt ?? 0n,
    nowSeconds: BigInt(Math.floor(now / 1_000)),
    hasSufficientInventory,
  }), [chainId, hasSufficientInventory, isConnected, now, online, stateQuery.data?.nextEligibleAt, stateQuery.data?.paused]);
  const busy = ["wallet-requested", "submitted", "confirming"].includes(transaction.stage);

  async function claim(): Promise<void> {
    if (!availability.canClaim || !publicClient) return;
    try {
      await executeFaucetClaim({
        write: () => writeContractAsync({
          address: bscTestnetDeployment.faucet.address,
          abi: faucetAbi,
          functionName: "claim",
        }),
        waitForReceipt: (hash) => publicClient.waitForTransactionReceipt({ hash }),
        invalidate: async () => {
          await queryClient.invalidateQueries({
            queryKey: ["setwise-faucet", bscTestnetDeployment.faucet.address],
          });
        },
        refresh: async () => {
          const result = await stateQuery.refetch();
          if (!result.data) throw new Error("Claim confirmed, but refreshed faucet balances are unavailable");
          return result.data;
        },
        onStage: (stage, hash) => setTransaction({ stage, hash }),
      });
      setNow(currentTimestamp());
    } catch (error) {
      setTransaction({
        stage: wasRejected(error) ? "rejected" : "reverted",
        error: errorMessage(error),
      });
    }
  }

  if (stateQuery.isPending) {
    return <section className="faucet-card" aria-live="polite">Reading faucet inventory and wallet balances…</section>;
  }
  if (stateQuery.error || !stateQuery.data) {
    return (
      <section className="faucet-card error-panel" role="alert">
        <h2>Faucet data is unavailable</h2>
        <p>{errorMessage(stateQuery.error)}</p>
        <button className="secondary-button" type="button" onClick={() => void stateQuery.refetch()}>Retry</button>
      </section>
    );
  }

  const nextEligible = stateQuery.data.nextEligibleAt > BigInt(Math.floor(now / 1_000));
  const buttonLabel = transaction.stage === "wallet-requested" ? "Confirm in wallet…"
    : transaction.stage === "submitted" ? "Submitted…"
      : transaction.stage === "confirming" ? "Confirming…"
        : transaction.stage === "success" ? "Claimed"
          : "Claim mock asset basket";

  return (
    <div className="faucet-layout">
      <section className="faucet-card faucet-claim-card">
        <div className="faucet-summary">
          <div><span>Basket assets</span><strong>{stateQuery.data.assets.length}</strong></div>
          <div><span>Cooldown</span><strong>{Number(stateQuery.data.cooldown) / 3_600} hours</strong></div>
        </div>

        <div className="faucet-assets" aria-label="Claim basket">
          {stateQuery.data.assets.map((asset) => {
            const enough = asset.inventory >= asset.claimAmount;
            return (
              <article className="faucet-asset" key={asset.address}>
                <div className="faucet-asset-heading">
                  <div><strong>{asset.symbol}</strong><span>{asset.name}</span></div>
                  <strong>{formatTokenAmount(asset.claimAmount, asset.decimals)}</strong>
                </div>
                <div className="faucet-asset-meta">
                  <span className={enough ? "inventory-ok" : "inventory-low"}>
                    {enough ? "Available" : "Insufficient"} · {formatTokenAmount(asset.inventory, asset.decimals)} remaining
                  </span>
                  <span>Wallet {formatTokenAmount(asset.walletBalance, asset.decimals)}</span>
                </div>
                <div className="token-actions">
                  <code title={asset.address}>{truncateAddress(asset.address)}</code>
                  <button type="button" onClick={() => void copyAddress(asset.address)
                    .then(() => setCopied(asset.address))
                    .catch((error) => setWalletAssetMessage(errorMessage(error)))}>
                    {copied && isAddressEqual(copied, asset.address) ? "Copied" : "Copy"}
                  </button>
                  <button type="button" onClick={() => void watchAsset(asset)
                    .then(() => setWalletAssetMessage(`${asset.symbol} was offered to your wallet.`))
                    .catch((error) => setWalletAssetMessage(errorMessage(error)))}>
                    Add token
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        {nextEligible && (
          <div className="cooldown-card">
            <span>Next eligible claim</span>
            <strong>{new Date(Number(stateQuery.data.nextEligibleAt) * 1_000).toLocaleString()}</strong>
            <span>{relativeTime(stateQuery.data.nextEligibleAt, now)}</span>
          </div>
        )}
        <FaucetAvailabilityNotice availability={availability} />
        <button className="primary-button" type="button" disabled={!availability.canClaim || busy} onClick={() => void claim()}>
          {buttonLabel}
        </button>
        <FaucetTransactionStatus stage={transaction.stage} error={transaction.error} />
        {transaction.hash && (
          <a className="transaction-link" href={`${runtimeConfig.explorerUrl}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">
            View transaction {truncateAddress(transaction.hash)}
          </a>
        )}
        {walletAssetMessage && <p className="quote-note" role="status">{walletAssetMessage}</p>}
      </section>

      <aside className="faucet-card bnb-card">
        <p className="eyebrow">Need test BNB?</p>
        <h2>BNB pays gas; it is not in this basket</h2>
        <p>Use the current BNB Chain faucet guide to obtain test BNB. It has no value and is separate from the mock ERC-20 assets above.</p>
        <a className="secondary-link" href={bscTestnetDeployment.testBnbFaucetUrl} target="_blank" rel="noreferrer">Open official BNB Chain faucet guide</a>
        <p>To create mock wrapped BNB, send test BNB through the permissionless <code>MockWrappedBNB.deposit()</code> flow at <code>{truncateAddress(bscTestnetDeployment.wrappedNative.address)}</code>.</p>
      </aside>

      <aside className="disclosure faucet-disclosure" role="note">
        <strong>No real value.</strong> These assets exist only for this unaudited testnet prototype. The 24-hour on-chain cooldown limits repeat claims per address but cannot prevent one person from using multiple wallets. No seed phrase, private key, email, IP address, or extra signature is collected.
      </aside>
    </div>
  );
}
