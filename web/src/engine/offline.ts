/**
 * Port of the offline analyst (src/hospital_ops_copilot/llm/narrator.py), its tools (llm/tools.py),
 * and the event stream of llm/agent.py. No language model: keyword routing plus fixed templates.
 */

import * as A from "./analytics";
import type { Dataset } from "./data";
import type { DocIndex } from "./docs";
import { check } from "./grounding";
import { ordinal, pyComma, pyPercent0, pyPlusG, pySigned, pyTitle } from "./pyfmt";

/* --------------------------------------------------------------------- tools */

export interface ToolResult {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  data: unknown;
  citations: Record<string, unknown>[];
  error: string | null;
}

const ccnOf = (c: unknown) => String(c).trim().replace(/^['"]+|['"]+$/g, "").padStart(6, "0");
const yearOf = (y: unknown): number | null => {
  if (y === null || y === undefined) return null;
  const n = Number.parseInt(String(y), 10);
  return Number.isNaN(n) ? null : n;
};

/** Parse a boolean argument the way the Python tools do ("false", "0", "no", "off" are false). */
export function asBool(v: unknown, fallback = true): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return !["false", "0", "no", "off", ""].includes(v.trim().toLowerCase());
  return fallback;
}

export class Tools {
  constructor(private ds: Dataset, private docs: DocIndex) {}

  run(name: string, rawArgs: Record<string, unknown>): ToolResult {
    const args: Record<string, unknown> = {};
    const input = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};
    for (const [k, v] of Object.entries(input)) {
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      args[k] = v;
    }
    const ds = this.ds;
    const ok = (a: Record<string, unknown>, data: unknown, citations: Record<string, unknown>[]): ToolResult => ({ name, args: a, ok: true, data, citations, error: null });
    try {
      switch (name) {
        case "search_hospitals": {
          const state = (args.state as string | undefined) ?? null;
          return ok({ query: args.query, state }, A.search(ds, String(args.query), state, 8), []);
        }
        case "get_hospital_profile": {
          const year = args.year ?? null;
          const d = A.profile(ds, ccnOf(args.ccn), yearOf(year));
          return ok({ ccn: args.ccn, year }, d, [d.source]);
        }
        case "benchmark_hospital": {
          const year = args.year ?? null;
          const d = A.benchmark(ds, ccnOf(args.ccn), yearOf(year), null, null);
          return ok({ ccn: args.ccn, year, peer_dims: null, kpis: null }, d, [d.source]);
        }
        case "find_opportunities": {
          const year = args.year ?? null;
          const target = String(args.target ?? "median").includes("quart") ? "top_quartile" : "median";
          const d = A.opportunities(ds, ccnOf(args.ccn), yearOf(year), null, target);
          return ok({ ccn: args.ccn, year, target }, d, [d.source]);
        }
        case "get_trend": {
          const kpis = ((args.kpis as string[] | undefined) ?? []).filter((k) => ds.kpiByKey.has(k));
          const d = A.trend(ds, ccnOf(args.ccn), kpis.length ? kpis : null);
          return ok({ ccn: args.ccn, kpis: kpis.length ? kpis : null }, d, [d.source]);
        }
        case "run_scenario": {
          const year = args.year ?? null;
          const f = (k: string) => Number(args[k] ?? 0);
          const d = A.scenario(ds, ccnOf(args.ccn), yearOf(year), f("volume_change_pct"), f("rate_change_pct"), f("opex_change_pct"), f("labor_cost_change_pct"));
          return ok({ ccn: args.ccn, year, ...d.inputs }, d, [d.source]);
        }
        case "rank_hospitals": {
          const year = args.year ?? null;
          const state = (args.state as string | undefined) ?? null;
          const facility = (args.facility_type as string | undefined) ?? null;
          const minBeds = Number(args.min_beds ?? 0);
          const topN = Number(args.top_n ?? 10);
          const best = asBool(args.best_first);
          const d = A.rank(ds, String(args.kpi), yearOf(year), state, facility, Math.trunc(minBeds || 0), Math.min(Math.trunc(topN || 10), 25), best);
          return ok({ kpi: args.kpi, year, state, facility_type: facility, min_beds: minBeds, top_n: topN, best_first: best }, d, [d.source]);
        }
        case "search_documentation": {
          const hits = this.docs.search(String(args.query), 3);
          return ok({ query: args.query }, hits, hits.map((h) => ({ dataset: h.source, title: h.title, url: h.url })));
        }
        default:
          return { name, args, ok: false, data: null, citations: [], error: `Unknown tool '${name}'.` };
      }
    } catch (e) {
      if (e instanceof A.NotFoundError || e instanceof A.InvalidInputError) return { name, args, ok: false, data: null, citations: [], error: e.message };
      // Bad arguments become a tool error the caller can recover from, as in Python.
      return { name, args, ok: false, data: null, citations: [], error: `Bad arguments: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

/* --------------------------------------------------------------------- routing (narrator.py) */

const KPI_SYNONYMS: [string, string[]][] = [
  ["operating_margin", ["operating margin", "margin", "profitab"]],
  ["total_margin", ["total margin", "net margin", "bottom line"]],
  ["opex_per_adj_discharge", ["cost per", "unit cost", "expense per", "cost per case", "cost per discharge"]],
  ["npr_per_adj_discharge", ["revenue per", "yield", "net revenue per"]],
  ["labor_cost_share", ["salary share", "labor cost", "salary cost"]],
  ["contract_labor_ratio", ["contract labor", "agency", "travel nurse"]],
  ["fte_per_adj_occupied_bed", ["fte", "staffing", "productivity", "headcount"]],
  ["occupancy_rate", ["occupancy", "bed utilization", "utilization"]],
  ["alos", ["length of stay", "alos", "los"]],
  ["cost_to_charge_ratio", ["cost-to-charge", "cost to charge", "ccr", "markup"]],
  ["contractual_allowance_pct", ["contractual allowance", "discount", "write-off", "write off"]],
  ["uncompensated_care_pct", ["uncompensated", "charity", "bad debt"]],
  ["medicare_day_share", ["medicare"]],
  ["medicaid_day_share", ["medicaid"]],
  ["outpatient_revenue_share", ["outpatient"]],
  ["days_cash_on_hand", ["cash on hand", "days cash", "liquidity"]],
  ["current_ratio", ["current ratio"]],
  ["days_in_ar", ["a/r", "accounts receivable", "days in ar", "collections", "revenue cycle"]],
  ["debt_to_assets", ["leverage", "debt", "liabilities"]],
];

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY GU VI".split(" "));
const STATE_NAMES_BY_LEN = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);

export function detectState(text: string, allowNames = true): string | null {
  const code = (text.match(/\b[A-Z]{2}\b/g) ?? []).find((w) => STATES.has(w)) ?? null;
  if (code || !allowNames) return code;
  const t = text.toLowerCase();
  for (const name of STATE_NAMES_BY_LEN) if (new RegExp(`\\b${name}\\b`).test(t)) return STATE_NAMES[name];
  return null;
}

export function detectMinBeds(text: string): number | null {
  const m = text.toLowerCase().match(/(\d{2,4})\+?\s*(?:or more\s*)?beds/);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function detectKpi(ds: Dataset, text: string): string | null {
  const t = text.toLowerCase();
  for (const k of ds.kpis) if (t.includes(k.key)) return k.key;
  let best: string | null = null;
  let bestLen = 0;
  for (const [key, words] of KPI_SYNONYMS) {
    for (const w of words) {
      if (t.includes(w) && w.length > bestLen) {
        best = key;
        bestLen = w.length;
      }
    }
  }
  return best;
}

export function detectIntent(q: string): string {
  const t = q.toLowerCase();
  if (/\b(what does|what is|define|definition|meaning|how is .* (calculated|computed|measured)|formula|methodology|how do you|how are|why (is|are|do|does))\b/.test(t) && !/\b(our|we|this hospital|\d{6})\b/.test(t)) return "docs";
  if (/what if|scenario|if (we|our|volume|rates?|costs?|expenses?|labor)|simulate|project(ion)?|what would|would happen|impact of|effect of/.test(t) && /\d/.test(t)) return "scenario";
  if (/\b(rank|top \d+|top|best|worst|leaderboard|highest|lowest)\b/.test(t) && !/\b(our|we|\d{6})\b/.test(t)) return "rank";
  if (/trend|over time|since|history|changed|year over year|yoy|trajectory/.test(t)) return "trend";
  if (/opportunit|sav(e|ing)|cut|reduce cost|improve|where (can|should)|gap/.test(t)) return "opportunities";
  if (/profile|overview|tell me about|who is|basic|how many|how much|what (was|is) (our|the) (net|total|revenue|income|fte|bed)/.test(t) && !/compar|peer|benchmark/.test(t)) return "profile";
  return "benchmark";
}

export function parseLevers(q: string): Record<string, number> {
  let t = q.toLowerCase();
  const out: Record<string, number> = {};
  const patterns: [string, string][] = [
    ["volume_change_pct", "(volume|discharges|admissions|patients)"],
    ["rate_change_pct", "(rates?|prices?|reimbursement|payments?)"],
    ["labor_cost_change_pct", "(labor|wages?|salar(y|ies))"],
    ["opex_change_pct", "(costs?|expenses?|opex|spending)"],
  ];
  for (const [key, noun] of patterns) {
    const m = new RegExp(`${noun}[^.%\\d]{0,30}?(?<v>[-+]?\\d+(?:\\.\\d+)?)\\s?%`).exec(t) ?? new RegExp(`(?<v>[-+]?\\d+(?:\\.\\d+)?)\\s?%[^.%\\d]{0,25}?${noun}`).exec(t);
    if (m) {
      let v = Number.parseFloat(m.groups!.v);
      const start = m.index;
      const end = start + m[0].length;
      const window = t.slice(Math.max(0, start - 8), end);
      if (/(cut|reduc|lower|decreas|drop|fall|declin|less)/.test(window) && v > 0) v = -v;
      out[key] = v;
      t = t.slice(0, start) + " ".repeat(end - start) + t.slice(end);
    }
  }
  if ("labor_cost_change_pct" in out && "opex_change_pct" in out && out.labor_cost_change_pct === out.opex_change_pct) delete out.opex_change_pct;
  return out;
}

const n0 = (v: number | null) => (v === null ? "n/a" : pyComma(v, 0));

/* --------------------------------------------------------------------- templates */

function err(r: ToolResult): string | null {
  return r.ok ? null : `I could not get that data: ${r.error}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function tBenchmark(r: ToolResult, kpi: string | null): string {
  const e = err(r);
  if (e) return e;
  const d = r.data as Any;
  const h = d.hospital;
  const pg = d.peer_group;
  let rows = (d.kpis as Any[]).filter((x) => x.value !== null);
  const lines = [`**${h.name}** (${h.ccn}, ${h.year}) compared with ${pg.n_hospitals} peers (${pg.definition}):`, ""];
  if (kpi) {
    const focus = rows.filter((x) => x.kpi === kpi);
    rows = focus.concat(rows.filter((x) => x.kpi !== kpi && (x.status === "better than peers" || x.status === "worse than peers")).slice(0, 3));
  } else {
    const headline = ["operating_margin", "opex_per_adj_discharge", "npr_per_adj_discharge", "fte_per_adj_occupied_bed", "occupancy_rate", "alos", "days_in_ar"];
    rows = rows.filter((x) => headline.includes(x.kpi));
  }
  for (const x of rows) {
    const pct = x.percentile !== null ? `, ${ordinal(x.percentile)} percentile` : "";
    lines.push(`- ${x.label}: ${x.value_fmt} vs peer median ${x.peer_median_fmt}${pct} (${x.status}).`);
  }
  const worse = (d.kpis as Any[]).filter((x) => x.status === "worse than peers").map((x) => x.label.toLowerCase());
  const better = (d.kpis as Any[]).filter((x) => x.status === "better than peers").map((x) => x.label.toLowerCase());
  lines.push("");
  if (better.length) lines.push(`Strengths: ${better.join(", ")}.`);
  if (worse.length) lines.push(`Watch: ${worse.join(", ")}.`);
  if (pg.relaxed_dimensions.length) lines.push(`Peer group was widened (dropped ${pg.relaxed_dimensions.join(", ")}) to reach enough peers.`);
  lines.push("Benchmarks are not adjusted for case mix.");
  return lines.join("\n");
}

function tOpps(r: ToolResult): string {
  const e = err(r);
  if (e) return e;
  const d = r.data as Any;
  if (!d.opportunities.length) return `${d.hospital.name} is at or better than the ${d.target} on every sized KPI in ${d.hospital.year}.`;
  const lines = [`**${d.hospital.name}** (${d.hospital.year}), gaps to the ${d.target} of ${d.peer_group.n_hospitals} peers (${d.peer_group.definition}):`, ""];
  for (const o of d.opportunities) {
    const impact = o.annual_impact_usd !== null ? o.annual_impact_fmt : o.assumptions.split(". ")[0];
    lines.push(`- ${o.area}: ${o.current} vs target ${o.target}, ${impact} (${o.impact_type}).`);
  }
  lines.push("", `Estimated recurring cost savings: ${d.total_recurring_cost_savings_fmt} a year (labor gaps are part of the unit-cost gap, so they are not added).`, d.caveat);
  return lines.join("\n");
}

function tTrend(ds: Dataset, r: ToolResult): string {
  const e = err(r);
  if (e) return e;
  const d = r.data as Any;
  const lines = [`**${d.hospital.name}**, ${d.series[0].year} to ${d.series.at(-1).year}:`, ""];
  for (const k of d.kpis) {
    const c = d.change[k];
    if (!c) continue;
    const lastMed = d.series.at(-1)[`${k}_peer_median`] ?? null;
    lines.push(`- ${ds.kpiByKey.get(k)!.label}: ${A.formatValue(ds, k, c.from)} to ${A.formatValue(ds, k, c.to)} (${c.change_fmt}); latest peer median ${A.formatValue(ds, k, lastMed)}.`);
  }
  const partial = (d.series as Any[]).filter((p) => !p.full_year_report).map((p) => String(p.year));
  if (partial.length) lines.push(`Partial-year reports: ${partial.join(", ")}.`);
  return lines.join("\n");
}

function tScenario(r: ToolResult): string {
  const e = err(r);
  if (e) return e;
  const d = r.data as Any;
  const levers = Object.entries(d.inputs as Record<string, number>)
    .filter(([k, v]) => k !== "variable_cost_share" && v)
    .map(([k, v]) => `${k.replace("_change_pct", "").replaceAll("_", " ")} ${pyPlusG(v)}%`)
    .join(", ") || "no change";
  return (
    `**${d.hospital.name}** (${d.hospital.year}) what-if: ${levers}.\n\n` +
    `- Operating margin: ${d.baseline.operating_margin_fmt} to ${d.scenario.operating_margin_fmt} (${pySigned(d.delta.operating_margin_pp, 1)} points).\n` +
    `- Operating income changes by ${d.delta.operating_income_fmt} (revenue ${A.formatUsd(d.scenario.net_patient_revenue)}, expense ${A.formatUsd(d.scenario.operating_expense)}).\n\n` +
    `Assumes ${pyPercent0(d.inputs.variable_cost_share)} of operating expense varies with volume.`
  );
}

function tProfile(r: ToolResult): string {
  const e = err(r);
  if (e) return e;
  const d = r.data as Any;
  const f = d.financials;
  return (
    `**${d.name}** (${d.ccn}), ${d.city}, ${d.state}: ${d.facility_type}, ${d.ownership}, ${n0(d.beds)} beds. Cost report ${d.year} (${d.fiscal_period}).\n\n` +
    `- Net patient revenue ${A.formatUsd(f.net_patient_revenue)}, operating expense ${A.formatUsd(f.operating_expense)}, net income ${A.formatUsd(f.net_income)}.\n` +
    `- Payroll FTEs ${n0(f.fte)}, discharges ${n0(f.discharges)}, beds ${n0(d.beds)}.\n` +
    `- Operating margin ${d.kpis_formatted.operating_margin}, occupancy ${d.kpis_formatted.occupancy_rate}, average length of stay ${d.kpis_formatted.alos}.`
  );
}

function tRank(r: ToolResult): string {
  const e = err(r);
  if (e) return e;
  const d = r.data as Any;
  const where = Object.entries(d.filters as Record<string, unknown>).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "all hospitals";
  const lines = [`**${d.label}**, ${d.year}, ${d.order} (${where}; ${d.hospitals_considered} hospitals):`, ""];
  for (const x of d.results) lines.push(`${x.rank}. ${x.name} (${x.city}, ${x.state}): ${x.value_fmt}`);
  lines.push("", "Extreme values can reflect reporting differences; check the hospital's data quality flags.");
  return lines.join("\n");
}

function tDocs(r: ToolResult): string {
  const e = err(r);
  if (e) return e;
  const data = r.data as Any[];
  if (!data.length) return "I found nothing in the documentation for that.";
  const top = data[0];
  let body: string = top.text;
  if (body.length > 900) {
    const cut = body.slice(0, 900);
    const i = cut.lastIndexOf(" ");
    body = (i >= 0 ? cut.slice(0, i) : cut) + "...";
  }
  const others = data.slice(1).map((h) => h.title).join("; ");
  return `**${top.title}**\n\n${body}` + (others ? `\n\nRelated: ${others}.` : "");
}

/* --------------------------------------------------------------------- router */

function resolve(ds: Dataset, tools: Tools, q: string, results: ToolResult[]): string | null {
  const m = q.match(/\b(\d{6})\b/);
  if (m && A.getRow(ds, m[1])) return m[1];
  const state = detectState(q, false);
  let name = q.replace(
    /\b(how|does|do|is|are|what|which|compare|compared|benchmark|to|its|their|peers?|in|the|for|of|vs|versus|trend|opportunit\w*|savings?|margin|cost|show|me|tell|about|our|we|hospital's|year|fy)\b|\d{4}|[?.,]/gi,
    " ",
  );
  name = name.split(/\s+/).filter(Boolean).join(" ");
  if (name.length < 3) return null;
  const r = tools.run("search_hospitals", { query: name, state });
  results.push(r);
  return r.ok && (r.data as Any[]).length ? (r.data as Any[])[0].ccn : null;
}

export function offlineAnswer(ds: Dataset, tools: Tools, question: string, contextCcn?: string | null, contextYear?: number | null): { text: string; results: ToolResult[] } {
  const intent = detectIntent(question);
  const results: ToolResult[] = [];
  const ym = question.match(/\b(20[12]\d)\b/);
  const year = ym ? Number.parseInt(ym[1], 10) : (contextYear ?? null);
  const kpi = detectKpi(ds, question);
  let text = "";
  if (intent === "docs") {
    const r = tools.run("search_documentation", { query: question });
    results.push(r);
    text = tDocs(r);
  } else if (intent === "rank") {
    const state = detectState(question);
    const k = ds.kpiByKey.get(kpi ?? "") ?? ds.kpis[0];
    const worst = /worst|lowest|bottom/.test(question.toLowerCase()) && k.direction !== "lower";
    const r = tools.run("rank_hospitals", { kpi: kpi ?? "operating_margin", year, state, min_beds: detectMinBeds(question) || 25, top_n: 10, best_first: !worst });
    results.push(r);
    text = tRank(r);
  } else {
    let ccn: string | null = null;
    if (!/\b(our|we|us|this hospital)\b/.test(question.toLowerCase()) || !contextCcn) {
      ccn = !contextCcn || /\b\d{6}\b/.test(question) ? resolve(ds, tools, question, results) : null;
    }
    ccn = ccn || contextCcn || null;
    if (!ccn) {
      text = "I could not tell which hospital you mean. Name the hospital (and state), give its 6-digit CCN, or select one in the sidebar.";
    } else if (intent === "scenario") {
      const levers = parseLevers(question);
      const r = tools.run("run_scenario", { ccn, year, ...(Object.keys(levers).length ? levers : { volume_change_pct: 5.0 }) });
      results.push(r);
      text = tScenario(r);
    } else if (intent === "trend") {
      const r = tools.run("get_trend", { ccn, kpis: kpi ? [kpi] : null });
      results.push(r);
      text = tTrend(ds, r);
    } else if (intent === "opportunities") {
      const target = question.toLowerCase().includes("quartile") ? "top_quartile" : "median";
      const r = tools.run("find_opportunities", { ccn, year, target });
      results.push(r);
      text = tOpps(r);
    } else if (intent === "profile") {
      const r = tools.run("get_hospital_profile", { ccn, year });
      results.push(r);
      text = tProfile(r);
    } else {
      const r = tools.run("benchmark_hospital", { ccn, year });
      results.push(r);
      text = tBenchmark(r, kpi);
    }
  }
  return { text, results };
}

/* --------------------------------------------------------------------- answer assembly (agent.py) */

const FOLLOWUPS: Record<string, string[]> = {
  benchmark_hospital: ["What are our biggest savings opportunities?", "How has our operating margin changed over time?"],
  find_opportunities: ["What if we cut operating expenses 3%?", "How does our staffing compare with peers?"],
  get_trend: ["How do we compare to peers this year?", "What are our biggest savings opportunities?"],
  run_scenario: ["What if volume also grows 5%?", "Where are our biggest savings opportunities?"],
  rank_hospitals: ["How do we compare to these hospitals?", "How is operating margin calculated?"],
  search_documentation: ["How do we compare to peers on this metric?", "How are peer groups defined?"],
  get_hospital_profile: ["How do we compare to our peers?", "What are our biggest savings opportunities?"],
};

export function suggestFollowups(toolsCalled: string[]): string[] {
  const out: string[] = [];
  for (const name of [...toolsCalled].reverse()) for (const q of FOLLOWUPS[name] ?? []) if (!out.includes(q)) out.push(q);
  return out.length ? out.slice(0, 3) : ["How do we compare to our peers?", "What are our biggest savings opportunities?"];
}

export function toolSummary(tr: ToolResult): string {
  if (!tr.ok) return tr.error ?? "failed";
  const d = tr.data as Any;
  const title = pyTitle;
  switch (tr.name) {
    case "search_hospitals": return `${d.length} match(es)` + (d.length ? `: ${title(d[0].name)}` : "");
    case "benchmark_hospital": return `${d.kpis.length} KPIs vs ${d.peer_group.n_hospitals} peers`;
    case "find_opportunities": return `${d.opportunities.length} opportunities, ${d.total_recurring_cost_savings_fmt} recurring`;
    case "get_trend": return `${d.series.length} years`;
    case "run_scenario": return `margin ${d.baseline.operating_margin_fmt} to ${d.scenario.operating_margin_fmt}`;
    case "rank_hospitals": return `top ${d.results.length} of ${d.hospitals_considered}`;
    case "search_documentation": return `${d.length} passage(s)`;
    case "get_hospital_profile": return `${title(d.name)}, ${d.year}`;
    default: return "ok";
  }
}

/** JSON with sorted keys, matching Python json.dumps(sort_keys=True) for de-duplication. */
function stableKey(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableKey).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableKey((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function finalAnswer(question: string, text: string, results: ToolResult[]) {
  const seen = new Set<string>();
  const sources: Record<string, unknown>[] = [];
  for (const t of results) {
    for (const c of t.citations) {
      const key = stableKey(c);
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(c);
      }
    }
  }
  const toolsCalled = results.map((t) => t.name);
  return {
    type: "final" as const,
    question,
    answer: text,
    backend: "offline" as const,
    model: null,
    tools_called: toolsCalled,
    tool_calls: results.map((t) => ({ name: t.name, args: t.args, ok: t.ok, error: t.error })),
    sources,
    grounding: check(text, results.filter((t) => t.ok).map((t) => t.data)),
    steps: results.length,
    prompt_tokens: 0,
    completion_tokens: 0,
    notes: [] as string[],
    followups: suggestFollowups(toolsCalled),
  };
}
