import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { BrowserRouter } from "react-router-dom";
import { WagmiProvider } from "wagmi";
import { Theme } from "@astryxdesign/core/theme";
import { y2kTheme } from "@astryxdesign/theme-y2k/built";

import { wagmiConfig } from "../config/wallet";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 10_000,
    },
  },
});

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <Theme theme={y2kTheme} mode="dark">
      <WagmiProvider config={wagmiConfig} reconnectOnMount>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>{children}</BrowserRouter>
        </QueryClientProvider>
      </WagmiProvider>
    </Theme>
  );
}
