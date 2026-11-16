import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Status } from "./api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|And|The|At|In)\b/g, (m) => m.toLowerCase())
    .replace(/\bHca\b/g, "HCA")
    .replace(/\bFl\b/g, "FL");
}

export function usd(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export function formatKpi(unit: string | undefined, v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  switch (unit) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "usd":
      return `$${Math.round(v).toLocaleString("en-US")}`;
    case "days":
      return `${v.toFixed(1)} days`;
    case "count":
      return Math.round(v).toLocaleString("en-US");
    default:
      return v.toFixed(2);
  }
}

export const STATUS_STYLE: Record<Status, { label: string; dot: string; chip: string; text: string }> = {
  "better than peers": {
    label: "Better than peers",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  "worse than peers": {
    label: "Worse than peers",
    dot: "bg-rose-500",
    chip: "bg-rose-500/10 text-rose-600 ring-rose-500/25 dark:text-rose-400",
    text: "text-rose-600 dark:text-rose-400",
  },
  "in line with peers": {
    label: "In line",
    dot: "bg-slate-400",
    chip: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300",
    text: "text-slate-600 dark:text-slate-300",
  },
  "above peer range": {
    label: "Above range",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400",
    text: "text-amber-700 dark:text-amber-400",
  },
  "below peer range": {
    label: "Below range",
    dot: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-400",
    text: "text-sky-700 dark:text-sky-400",
  },
  "insufficient data": {
    label: "No data",
    dot: "bg-zinc-300",
    chip: "bg-zinc-500/10 text-zinc-500 ring-zinc-500/20",
    text: "text-zinc-500",
  },
};

export const PEER_DIM_LABEL: Record<string, string> = {
  facility_type: "Facility type",
  bed_band: "Bed size",
  state: "State",
  ownership: "Ownership",
  urban_rural: "Urban/rural",
};

export const TOOL_LABEL: Record<string, string> = {
  search_hospitals: "Finding hospital",
  get_hospital_profile: "Reading cost report",
  benchmark_hospital: "Benchmarking against peers",
  find_opportunities: "Sizing opportunities",
  get_trend: "Pulling multi-year trend",
  run_scenario: "Running what-if model",
  rank_hospitals: "Ranking hospitals",
  search_documentation: "Searching methodology and CMS docs",
};
