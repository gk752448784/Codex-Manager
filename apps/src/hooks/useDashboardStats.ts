"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buildStartupSnapshotQueryKey,
  hasStartupSnapshotSignal,
  STARTUP_SNAPSHOT_REQUEST_LOG_LIMIT,
  STARTUP_SNAPSHOT_STALE_TIME,
  STARTUP_SNAPSHOT_WARMUP_INTERVAL_MS,
  STARTUP_SNAPSHOT_WARMUP_TIMEOUT_MS,
} from "@/lib/api/startup-snapshot";
import { serviceClient } from "@/lib/api/service-client";
import { useAppStore } from "@/lib/store/useAppStore";
import { pickBestRecommendations, pickCurrentAccount } from "@/lib/utils/usage";

export function useDashboardStats() {
  const serviceStatus = useAppStore((state) => state.serviceStatus);
  const isServiceReady = serviceStatus.connected;
  const warmupStartedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isServiceReady) {
      warmupStartedAtRef.current = null;
      return;
    }
    warmupStartedAtRef.current = Date.now();
  }, [isServiceReady, serviceStatus.addr]);

  const snapshotQuery = useQuery({
    queryKey: buildStartupSnapshotQueryKey(
      serviceStatus.addr,
      STARTUP_SNAPSHOT_REQUEST_LOG_LIMIT
    ),
    queryFn: () =>
      serviceClient.getStartupSnapshot({
        requestLogLimit: STARTUP_SNAPSHOT_REQUEST_LOG_LIMIT,
      }),
    enabled: isServiceReady,
    retry: 1,
    staleTime: STARTUP_SNAPSHOT_STALE_TIME,
    refetchInterval: (query) => {
      if (!isServiceReady) return false;
      const startedAt = warmupStartedAtRef.current;
      if (startedAt == null) return false;
      if (Date.now() - startedAt >= STARTUP_SNAPSHOT_WARMUP_TIMEOUT_MS) {
        warmupStartedAtRef.current = null;
        return false;
      }

      const snapshot = query.state.data;
      if (!snapshot || snapshot.accounts.length === 0) {
        return false;
      }

      return hasStartupSnapshotSignal(snapshot)
        ? false
        : STARTUP_SNAPSHOT_WARMUP_INTERVAL_MS;
    },
    refetchIntervalInBackground: true,
  });

  const data = snapshotQuery.data;
  const accounts = data?.accounts || [];
  const hasStartupSignal = hasStartupSnapshotSignal(data);
  const shouldWarmupPoll =
    isServiceReady &&
    accounts.length > 0 &&
    !hasStartupSignal &&
      snapshotQuery.isFetching;
  const totalAccounts = accounts.length;
  const availableAccounts = accounts.filter((item) => item.availabilityLevel === "ok").length;
  const unavailableAccounts = accounts.filter((item) => item.availabilityLevel === "bad").length;
  const currentAccount = pickCurrentAccount(
    accounts,
    data?.requestLogs || [],
    data?.manualPreferredAccountId,
    data?.currentAuthAccountId
  );
  const recommendations = pickBestRecommendations(accounts);

  return {
    stats: {
      total: totalAccounts,
      available: availableAccounts,
      unavailable: unavailableAccounts,
      todayTokens: data?.requestLogTodaySummary.todayTokens || 0,
      cachedTokens: data?.requestLogTodaySummary.cachedInputTokens || 0,
      reasoningTokens: data?.requestLogTodaySummary.reasoningOutputTokens || 0,
      todayCost: data?.requestLogTodaySummary.estimatedCost || 0,
      poolRemain: {
        primary: data?.usageAggregateSummary.primaryRemainPercent ?? null,
        secondary: data?.usageAggregateSummary.secondaryRemainPercent ?? null,
        primaryKnownCount: data?.usageAggregateSummary.primaryKnownCount ?? 0,
        primaryBucketCount: data?.usageAggregateSummary.primaryBucketCount ?? 0,
        secondaryKnownCount: data?.usageAggregateSummary.secondaryKnownCount ?? 0,
        secondaryBucketCount: data?.usageAggregateSummary.secondaryBucketCount ?? 0,
      },
    },
    currentAccount,
    recommendations,
    requestLogs: data?.requestLogs || [],
    isLoading: !isServiceReady || snapshotQuery.isPending || shouldWarmupPoll,
    isSyncingSnapshot: shouldWarmupPoll,
    isServiceReady,
    isError: snapshotQuery.isError,
    error: snapshotQuery.error,
  };
}
