import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { runtimeConfig } from "../config/env";
import { tokenListQueryKeys } from "./queryKeys";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const tokenSchema = z.object({
  address: addressSchema,
  assetType: z.string().min(1).optional(),
  chainId: z.number().int().positive(),
  logoURI: z.string().url().optional(),
  name: z.string().min(1),
  symbol: z.string().min(1),
  underlyingSymbol: z.string().min(1).optional(),
}).passthrough();

const tokenListSchema = z.object({ tokens: z.array(tokenSchema) }).passthrough();

export type TokenMetadata = z.infer<typeof tokenSchema>;

export type TokenMetadataIndex = ReadonlyMap<string, TokenMetadata>;

export class TokenListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenListError";
  }
}

export function tokenMetadataKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export function parseTokenList(value: unknown): TokenMetadata[] {
  const parsed = tokenListSchema.safeParse(value);
  if (!parsed.success) throw new TokenListError("Token metadata returned an invalid token list");
  return parsed.data.tokens;
}

export function createTokenMetadataIndex(tokens: readonly TokenMetadata[]): TokenMetadataIndex {
  const index = new Map<string, TokenMetadata>();
  for (const token of tokens) {
    const key = tokenMetadataKey(token.chainId, token.address);
    if (index.has(key)) throw new TokenListError("Token metadata contains duplicate chain and address entries");
    index.set(key, token);
  }
  return index;
}

export type TokenDisplay = {
  assetType?: string;
  logoURI?: string;
  name: string;
  symbol: string;
  underlyingSymbol?: string;
};

type RfqDisplayAsset = {
  address: string;
  name?: string;
  symbol: string;
  underlying?: { symbol: string };
};

export function enrichTokenDisplay(
  asset: RfqDisplayAsset,
  chainId: number,
  index?: TokenMetadataIndex,
): TokenDisplay {
  const token = index?.get(tokenMetadataKey(chainId, asset.address));
  return {
    assetType: token?.assetType,
    logoURI: token?.logoURI,
    name: token?.name ?? asset.name ?? asset.symbol,
    symbol: token?.symbol ?? asset.symbol,
    underlyingSymbol: token?.underlyingSymbol ?? asset.underlying?.symbol,
  };
}

export async function fetchTokenList(signal?: AbortSignal): Promise<TokenMetadataIndex> {
  let response: Response;
  try {
    response = await fetch(runtimeConfig.tokenListUrl, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new TokenListError("Token metadata is unavailable");
  }
  if (!response.ok) throw new TokenListError("Token metadata is unavailable");
  const json: unknown = await response.json().catch(() => null);
  return createTokenMetadataIndex(parseTokenList(json));
}

export function useTokenMetadata() {
  return useQuery({
    queryKey: tokenListQueryKeys.all,
    queryFn: ({ signal }) => fetchTokenList(signal),
    staleTime: 60 * 60 * 1_000,
    retry: 1,
  });
}
