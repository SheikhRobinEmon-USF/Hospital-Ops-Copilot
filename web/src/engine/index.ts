/**
 * In-browser engine for the public demo: the same API surface as the FastAPI service, computed locally.
 *
 * Loading strategy (fast first paint):
 * 1. A tiny precomputed snapshot of the default view (started by an inline <head> script) answers the
 *    first requests immediately.
 * 2. The full dataset (about 2 MB compressed) loads in the background once the page is idle, or as soon
 *    as a request needs it.
 */

import * as A from "./analytics";
import { decode, type Dataset, type KpiDefLite } from "./data";
import { type Chunk, DocIndex } from "./docs";
import { finalAnswer, offlineAnswer, Tools, toolSummary } from "./offline";

export { NotFoundError } from "./analytics";

const BASE = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const dataUrl = (file: string) => `${BASE}/data/${file}`;

export interface Engine {
  ds: Dataset;
  docs: DocIndex;
  tools: Tools;
}

type Snapshot = Record<string, unknown>;
declare global {
  interface Window {
    __hocSnapshot?: Promise<Snapshot>;
  }
}

/** Request key shared with Python's web_export.snapshot_key (keep in sync). */
export function snapshotKey(...parts: (string | number | string[] | null | undefined)[]): string {
  return parts.map((p) => (p === null || p === undefined ? "" : Array.isArray(p) ? p.join(",") : String(p))).join("|");
}

let snapshotPromise: Promise<Snapshot> | null = null;
function snapshot(): Promise<Snapshot> {
  if (!snapshotPromise) {
    const early = typeof window !== "undefined" ? window.__hocSnapshot : undefined;
    snapshotPromise = (early ?? fetch(dataUrl("snapshot.json")).then((r) => (r.ok ? r.json() : {}))).catch(() => ({}));
  }
  return snapshotPromise;
}

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(dataUrl(file));
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return res.json() as Promise<T>;
}

let enginePromise: Promise<Engine> | null = null;
export function getEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [data, kpis, corpus] = await Promise.all([
        fetchJson<Parameters<typeof decode>[0]>("hospitals.json"),
        fetchJson<KpiDefLite[]>("kpis.json"),
        fetchJson<Chunk[]>("corpus.json"),
      ]);
      const ds = decode(data, kpis);
      const docs = new DocIndex(corpus);
      return { ds, docs, tools: new Tools(ds, docs) };
    })();
    enginePromise.catch(() => {
      enginePromise = null; // allow a retry after a network failure
    });
  }
  return enginePromise;
}

/** Warm the full dataset when the browser is idle, so later interactions are instant. */
export function warmEngine(): void {
  if (typeof window === "undefined") return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  const start = () => void getEngine().catch(() => {});
  if (ric) ric(start, { timeout: 4000 });
  else setTimeout(start, 1500);
}

async function cached<T>(key: string, compute: (e: Engine) => T): Promise<T> {
  const snap = await snapshot();
  if (key in snap) {
    warmEngine();
    return structuredClone(snap[key]) as T;
  }
  return compute(await getEngine());
}

export const browserApi = {
  health: () =>
    cached("health", ({ ds }) => ({
      status: "ok", version: "", years: ds.years, hospitals: ds.byCcn.size, llm_backend: "offline", chat_model: "", embed_model: "", ollama_available: false,
    })),
  models: async () => ({ ollama_available: false, default: "", models: [] as string[] }),
  kpis: () => cached("kpis", ({ ds }) => ds.kpis),
  search: async (q: string) => A.search((await getEngine()).ds, q, null, 12),
  profile: (ccn: string, year?: number) => cached(snapshotKey("profile", ccn, year), ({ ds }) => A.profileWithYears(ds, ccn, year)),
  benchmark: (ccn: string, year: number | undefined, peerDims: string[]) =>
    cached(snapshotKey("benchmark", ccn, year, peerDims), ({ ds }) => A.benchmark(ds, ccn, year, peerDims)),
  insights: (ccn: string, year: number | undefined, peerDims: string[]) =>
    cached(snapshotKey("insights", ccn, year, peerDims), ({ ds }) => A.insights(ds, ccn, year, peerDims)),
  opportunities: async (ccn: string, year: number | undefined, peerDims: string[], target: string) =>
    A.opportunities((await getEngine()).ds, ccn, year, peerDims, target),
  trend: (ccn: string, kpis: string[], peerDims: string[]) =>
    cached(snapshotKey("trend", ccn, kpis, peerDims), ({ ds }) => A.trend(ds, ccn, kpis, peerDims)),
  rankings: async (kpi: string, p: { year?: number; state?: string; facility_type?: string; min_beds?: number; best_first?: boolean; top_n?: number }) =>
    A.rank((await getEngine()).ds, kpi, p.year, p.state, p.facility_type, p.min_beds ?? 0, Math.min(p.top_n ?? 10, 100), p.best_first ?? true),
  scenario: async (ccn: string, b: Record<string, number | undefined>) =>
    A.scenario((await getEngine()).ds, ccn, b.year, b.volume_change_pct ?? 0, b.rate_change_pct ?? 0, b.opex_change_pct ?? 0, b.labor_cost_change_pct ?? 0, b.variable_cost_share ?? 0.35),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The offline analyst as an event stream, matching the API's /ask/stream events. */
export async function* streamAskLocal(body: { question: string; ccn?: string; year?: number }, signal?: AbortSignal) {
  const t0 = performance.now();
  yield { type: "start" as const, backend: "offline" as const, model: null };
  const { ds, tools } = await getEngine();
  const { text, results } = offlineAnswer(ds, tools, body.question, body.ccn ?? null, body.year ?? null);
  for (const r of results) {
    yield { type: "tool_start" as const, name: r.name, args: r.args };
    await sleep(120);
    yield { type: "tool_end" as const, name: r.name, ok: r.ok, summary: toolSummary(r) };
  }
  const words = text.match(/\S+\s*/g) ?? [];
  for (let i = 0; i < words.length; i += 6) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    yield { type: "token" as const, text: words.slice(i, i + 6).join("") };
    await sleep(14);
  }
  const final = finalAnswer(body.question, text, results);
  yield { ...final, latency_s: (performance.now() - t0) / 1000 };
}
