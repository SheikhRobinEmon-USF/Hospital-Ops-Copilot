/**
 * Typed client for the Hospital Ops Copilot FastAPI service.
 * Every number shown in the UI comes from these endpoints; the browser never computes KPIs.
 */

import { takePrefetched } from "./prefetch";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type Direction = "higher" | "lower" | null;
export type Status =
  | "better than peers"
  | "worse than peers"
  | "in line with peers"
  | "above peer range"
  | "below peer range"
  | "insufficient data";

export interface Citation {
  dataset: string;
  year?: number;
  ccn?: string;
  report_id?: string;
  fiscal_period?: string;
  fields?: string[];
  title?: string;
  url?: string;
}

export interface HospitalHit {
  ccn: string;
  name: string;
  city: string;
  state: string;
  facility_type: string;
  facility_type_desc: string;
  beds: number | null;
  latest_year: number;
}

export interface Profile {
  ccn: string;
  name: string;
  city: string;
  state: string;
  year: number;
  fiscal_period: string;
  facility_type: string;
  provider_type: string;
  ownership: string;
  urban_rural: string;
  beds: number | null;
  bed_band: string;
  full_year_report: boolean;
  financials: Record<
    "net_patient_revenue" | "operating_expense" | "net_income" | "total_assets" | "fte" | "discharges" |
      "adjusted_discharges" | "patient_days",
    number | null
  >;
  kpis: Record<string, number | null>;
  kpis_formatted: Record<string, string>;
  data_quality_flags: string[];
  available_years: number[];
  source: Citation;
}

export interface KpiRow {
  kpi: string;
  label: string;
  category: string;
  value: number | null;
  value_fmt: string;
  peer_median: number | null;
  peer_median_fmt: string;
  peer_p25: number | null;
  peer_p75: number | null;
  peer_range_fmt: string;
  percentile: number | null;
  peers_with_data: number;
  direction: Direction;
  status: Status;
}

export interface PeerGroup {
  definition: string;
  n_hospitals: number;
  requested?: string[];
  relaxed_dimensions?: string[];
  note?: string;
}

export interface Benchmark {
  hospital: { ccn: string; name: string; state: string; year: number; beds: number | null; facility_type: string };
  peer_group: PeerGroup;
  kpis: KpiRow[];
  source: Citation;
}

export interface Opportunity {
  area: string;
  kpi: string;
  current: string;
  target: string;
  annual_impact_usd: number | null;
  annual_impact_fmt: string;
  impact_type: "cost savings" | "one-time cash release" | "capacity" | "revenue upside";
  formula: string;
  assumptions: string;
}

export interface Opportunities {
  hospital: { ccn: string; name: string; year: number };
  target: string;
  peer_group: PeerGroup;
  opportunities: Opportunity[];
  total_recurring_cost_savings_usd: number;
  total_recurring_cost_savings_fmt: string;
  total_note: string;
  caveat: string;
}

export interface TrendPoint {
  year: number;
  full_year_report: boolean;
  [key: string]: number | boolean | null;
}

export interface Trend {
  hospital: { ccn: string; name: string };
  kpis: string[];
  series: TrendPoint[];
  change: Record<string, { from_year: number; to_year: number; from: number; to: number; change: number; change_fmt: string }>;
}

export interface Scenario {
  hospital: { ccn: string; name: string; year: number };
  inputs: Record<string, number>;
  baseline: { net_patient_revenue: number; operating_expense: number; operating_income: number; operating_margin: number; operating_margin_fmt: string };
  scenario: { net_patient_revenue: number; operating_expense: number; operating_income: number; operating_margin: number; operating_margin_fmt: string };
  delta: { operating_income: number; operating_income_fmt: string; operating_margin_pp: number };
  formula: string;
}

export interface Ranking {
  kpi: string;
  label: string;
  year: number;
  order: string;
  hospitals_considered: number;
  results: { rank: number; ccn: string; name: string; city: string; state: string; facility_type: string; beds: number | null; value: number; value_fmt: string }[];
}

export interface KpiDef {
  key: string;
  label: string;
  category: string;
  unit: "pct" | "usd" | "ratio" | "days" | "count";
  direction: Direction;
  formula: string;
  fields: string[];
  description: string;
}

export interface Insight {
  kind: "risk" | "strength" | "opportunity";
  kpi: string;
  title: string;
  detail: string;
  ask: string;
}

export interface Health {
  status: string;
  version: string;
  years: number[];
  hospitals: number;
  llm_backend: string;
  chat_model: string;
  embed_model: string;
  ollama_available: boolean;
}

export interface Grounding {
  numbers_checked: number;
  numbers_grounded: number;
  score: number;
  ungrounded: string[];
}

export interface FinalEvent {
  type: "final";
  question: string;
  answer: string;
  backend: "ollama" | "offline";
  model: string | null;
  tools_called: string[];
  tool_calls: { name: string; args: Record<string, unknown>; ok: boolean; error: string | null }[];
  sources: Citation[];
  grounding: Grounding | null;
  latency_s: number;
  steps: number;
  notes: string[];
  followups: string[];
}

export type StreamEvent =
  | { type: "start"; backend: "ollama" | "offline"; model: string | null }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; ok: boolean; summary: string }
  | { type: "token"; text: string }
  | { type: "reset" }
  | { type: "error"; message: string }
  | FinalEvent;

export type PeerDim = "facility_type" | "bed_band" | "state" | "ownership" | "urban_rural";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function qs(params: Record<string, string | number | boolean | string[] | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function get<T>(path: string, params: Parameters<typeof qs>[0] = {}, signal?: AbortSignal): Promise<T> {
  const url = `${API_URL}${path}${qs(params)}`;
  const early = takePrefetched<T>(url);
  if (early) {
    try {
      return await early;
    } catch {
      // fall through to a normal request
    }
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>("/health"),
  models: () => get<{ ollama_available: boolean; default: string; models: string[] }>("/models"),
  kpis: () => get<KpiDef[]>("/kpis"),
  search: (q: string, signal?: AbortSignal) => get<HospitalHit[]>("/hospitals/search", { q, limit: 12 }, signal),
  profile: (ccn: string, year?: number) => get<Profile>(`/hospitals/${ccn}`, { year }),
  benchmark: (ccn: string, year: number | undefined, peerDims: PeerDim[]) =>
    get<Benchmark>(`/hospitals/${ccn}/benchmark`, { year, peer_dims: peerDims }),
  insights: (ccn: string, year: number | undefined, peerDims: PeerDim[]) =>
    get<{ insights: Insight[]; peer_group: PeerGroup }>(`/hospitals/${ccn}/insights`, { year, peer_dims: peerDims }),
  opportunities: (ccn: string, year: number | undefined, peerDims: PeerDim[], target: "median" | "top_quartile") =>
    get<Opportunities>(`/hospitals/${ccn}/opportunities`, { year, peer_dims: peerDims, target }),
  trend: (ccn: string, kpis: string[], peerDims: PeerDim[]) =>
    get<Trend>(`/hospitals/${ccn}/trend`, { kpis, peer_dims: peerDims }),
  rankings: (kpi: string, p: { year?: number; state?: string; facility_type?: string; min_beds?: number; best_first?: boolean; top_n?: number }) =>
    get<Ranking>(`/rankings/${kpi}`, p),
  scenario: async (ccn: string, body: Record<string, number | undefined>): Promise<Scenario> => {
    const res = await fetch(`${API_URL}/hospitals/${ccn}/scenario`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return res.json();
  },
};

/** Stream copilot events over server-sent events (POST + ReadableStream). */
export async function* streamAsk(
  body: { question: string; ccn?: string; year?: number; model?: string; offline?: boolean; history?: { role: string; content: string }[] },
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(`${API_URL}/ask/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new ApiError(res.status, `Copilot request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6)) as StreamEvent;
    }
  }
}
