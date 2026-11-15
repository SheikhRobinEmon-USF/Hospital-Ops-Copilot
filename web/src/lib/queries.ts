"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { useWorkspace } from "./workspace";

/** Data hooks bound to the current workspace selection. keepPreviousData avoids layout flashes on change. */

export function useProfile() {
  const { ccn, year } = useWorkspace();
  return useQuery({ queryKey: ["profile", ccn, year], queryFn: () => api.profile(ccn, year), placeholderData: keepPreviousData });
}

export function useBenchmark() {
  const { ccn, year, peerDims } = useWorkspace();
  return useQuery({
    queryKey: ["benchmark", ccn, year, peerDims],
    queryFn: () => api.benchmark(ccn, year, peerDims),
    placeholderData: keepPreviousData,
  });
}

export function useInsights() {
  const { ccn, year, peerDims } = useWorkspace();
  return useQuery({
    queryKey: ["insights", ccn, year, peerDims],
    queryFn: () => api.insights(ccn, year, peerDims),
    placeholderData: keepPreviousData,
  });
}

export function useOpportunities(target: "median" | "top_quartile") {
  const { ccn, year, peerDims } = useWorkspace();
  return useQuery({
    queryKey: ["opportunities", ccn, year, peerDims, target],
    queryFn: () => api.opportunities(ccn, year, peerDims, target),
    placeholderData: keepPreviousData,
  });
}

export function useTrend(kpis: string[]) {
  const { ccn, peerDims } = useWorkspace();
  return useQuery({
    queryKey: ["trend", ccn, kpis, peerDims],
    queryFn: () => api.trend(ccn, kpis, peerDims),
    placeholderData: keepPreviousData,
  });
}

export function useKpiDefs() {
  return useQuery({ queryKey: ["kpis"], queryFn: api.kpis, staleTime: Infinity });
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 30_000, retry: 0 });
}

export function useModels() {
  return useQuery({ queryKey: ["models"], queryFn: api.models, staleTime: 30_000, retry: 0 });
}
