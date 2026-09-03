import type { SourceAssetDeployment } from "../../config/sourceAssets";
import type { DestinationStockMarket } from "../../data/markets";

export type RouteProvider = Readonly<{
  id: string;
  name: string;
}>;

export type ExecutionVenue = Readonly<{
  id: string;
  name: string;
}>;

export type RoutedSwapPlan = Readonly<{
  destinationChainId: DestinationStockMarket["chainId"];
  destinationMarket: DestinationStockMarket;
  executionVenue: ExecutionVenue;
  routeProvider: RouteProvider;
  sourceAsset: SourceAssetDeployment;
  sourceChainId: SourceAssetDeployment["chainId"];
}>;

/** Builds route intent only. Transaction submission remains outside this foundation. */
export function createRoutedSwapPlan(input: Readonly<{
  destinationMarket: DestinationStockMarket;
  executionVenue: ExecutionVenue;
  routeProvider: RouteProvider;
  sourceAsset: SourceAssetDeployment;
}>): RoutedSwapPlan {
  if (!input.routeProvider.id.trim()) throw new Error("Routed swap requires a route provider");
  if (!input.executionVenue.id.trim()) throw new Error("Routed swap requires an execution venue");
  return {
    ...input,
    destinationChainId: input.destinationMarket.chainId,
    sourceChainId: input.sourceAsset.chainId,
  };
}
