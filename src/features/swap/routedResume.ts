import { useEffect } from "react";

import {
  markRoutedSwapLifecycle,
  readResumableRoutedSwaps,
  type SwapActivityRecord,
} from "../activity/store";
import { requestSwapExecutionStatus } from "../../data/swapRouter/client";
import { routedSwapErrorMessage } from "./routedModel";
import { mapExecutionStatus } from "./routedExecution";

/**
 * Background tracking for routed swaps that may still settle. Runs app-wide so
 * a reload, navigation away from the swap page, or a closed tab (until the
 * next visit) still advances destination settlement and records evidence.
 */

export const RESUME_POLL_INTERVAL_MS = 20_000;
/** Settlement beyond a day is surfaced as unknown instead of being polled forever. */
export const MAX_TRACKING_AGE_MS = 24 * 60 * 60 * 1_000;

type ActivityStorage = Pick<Storage, "getItem" | "setItem">;

export function isStaleForTracking(record: SwapActivityRecord, now: number): boolean {
  return now - record.timestamp > MAX_TRACKING_AGE_MS;
}

export async function pollResumableRoutedSwaps(input: {
  now?: number;
  requestStatus?: typeof requestSwapExecutionStatus;
  storage?: ActivityStorage;
} = {}): Promise<void> {
  const requestStatus = input.requestStatus ?? requestSwapExecutionStatus;
  const now = input.now ?? Date.now();
  const records = readResumableRoutedSwaps(input.storage);
  for (const record of records) {
    const routed = record.routed;
    if (!routed) continue;
    if (isStaleForTracking(record, now)) continue;
    try {
      const status = await requestStatus({ quote: routed.quote, transactionHash: record.hash ?? undefined });
      const settlement = mapExecutionStatus(status);
      const detail = settlement.detail ?? undefined;
      if (settlement.kind === "pending") {
        markRoutedSwapLifecycle(record.id, settlement.lifecycle, {
          destinationHash: settlement.destinationHash,
          providerDetail: detail,
        }, input.storage);
        continue;
      }
      markRoutedSwapLifecycle(record.id, settlement.lifecycle, {
        destinationHash: settlement.destinationHash,
        error: settlement.lifecycle === "delivered" ? undefined : detail,
        providerDetail: detail,
      }, input.storage);
    } catch (error) {
      // Provider outage: keep the record resumable and surface the reason.
      markRoutedSwapLifecycle(record.id, "unknown", {
        providerDetail: routedSwapErrorMessage(error),
      }, input.storage);
    }
  }
}

/** Advances background settlement tracking while the app is open. */
export function useRoutedSwapResumption(): void {
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void pollResumableRoutedSwaps();
    };
    tick();
    const timer = window.setInterval(tick, RESUME_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
}
