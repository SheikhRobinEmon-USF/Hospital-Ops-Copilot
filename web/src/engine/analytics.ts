/**
 * TypeScript port of src/hospital_ops_copilot/analytics (benchmark.py, kpis.py, store.search).
 * Python is the source of truth; web/src/engine/parity.test.ts checks this port against
 * Python-generated fixtures. Keep the two in sync.
 */

import { type Dataset, num, type Row } from "./data";
import { ordinal, pyComma, pyFixed, pyPercent0, pyRound, pySigned } from "./pyfmt";

export const SOURCE_NAME = "CMS Hospital Provider Cost Report (HCRIS, form CMS-2552-10)";
export const PEER_DIMENSIONS: Record<string, string> = {
  facility_type: "facility type",
  bed_band: "bed size",
  state: "state",
  ownership: "ownership",
  urban_rural: "urban/rural",
};
export const DEFAULT_PEER_DIMS = ["facility_type", "bed_band"];
const MIN_PEERS = 10;
const RELAX_ORDER = ["state", "ownership", "urban_rural", "bed_band"];

export class NotFoundError extends Error {}

/** A request that cannot be computed, such as a what-if that removes all revenue (Python InvalidInputError). */
export class InvalidInputError extends Error {}

/* --------------------------------------------------------------------- formatting (kpis.py) */

export function formatValue(ds: Dataset, key: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const unit = ds.kpiByKey.get(key)?.unit ?? "ratio";
  if (unit === "pct") return `${pyFixed(value * 100, 1)}%`;
  if (unit === "usd") return `$${pyComma(value, 0)}`;
  if (unit === "days") return `${pyFixed(value, 1)} days`;
  if (unit === "count") return pyComma(value, 0);
  return pyFixed(value, 2);
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  if (v >= 1e9) return `${sign}$${pyFixed(v / 1e9, 2)}B`;
  if (v >= 1e6) return `${sign}$${pyFixed(v / 1e6, 1)}M`;
  if (v >= 1e3) return `${sign}$${pyFixed(v / 1e3, 0)}K`;
  return `${sign}$${pyComma(v, 0)}`;
}

/* --------------------------------------------------------------------- statistics (numpy) */

/** numpy.percentile(..., method="linear") on an unsorted array, for several q values. */
export function npPercentile(values: number[], qs: number[]): number[] {
  const a = [...values].sort((x, y) => x - y);
  const n = a.length;
  return qs.map((qPct) => {
    const q = qPct / 100;
    const virtual = (n - 1) * q;
    let prev = Math.floor(virtual);
    let next = prev + 1;
    if (virtual >= n - 1) {
      prev = n - 1;
      next = n - 1;
    }
    const gamma = virtual - Math.floor(virtual);
    const lo = a[prev];
    const hi = a[next];
    const diff = hi - lo;
    return gamma >= 0.5 ? hi - diff * (1 - gamma) : lo + diff * gamma;
  });
}

/** pandas Series.median (NaN skipped; mean of the two middle values for even counts). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/* --------------------------------------------------------------------- store */

export function getRow(ds: Dataset, ccn: string, year?: number | null): Row | null {
  const rows = ds.byCcn.get(String(ccn).trim().padStart(6, "0"));
  if (!rows?.length) return null;
  if (year === undefined || year === null) return rows.at(-1)!;
  return rows.find((r) => r.year === Number(year)) ?? null;
}

function mustRow(ds: Dataset, ccn: string, year?: number | null): Row {
  const r = getRow(ds, ccn, year);
  if (!r) {
    const hint = year ? ` for ${year}` : "";
    throw new NotFoundError(`No cost report found for CCN ${ccn}${hint}. Available years: [${ds.years.join(", ")}]`);
  }
  return r;
}

export function sourceCitation(r: Row, fields: string[] = []) {
  return {
    dataset: SOURCE_NAME,
    year: r.year,
    ccn: r.ccn,
    report_id: r.report_id as string,
    fiscal_period: `${r.fy_begin} to ${r.fy_end}`,
    fields,
  };
}

/* --------------------------------------------------------------------- profile */

export function profile(ds: Dataset, ccn: string, year?: number | null) {
  const r = mustRow(ds, ccn, year);
  const kpis: Record<string, number | null> = {};
  for (const k of ds.kpis) kpis[k.key] = num(r, k.key);
  const kpisFormatted: Record<string, string> = {};
  for (const [k, v] of Object.entries(kpis)) kpisFormatted[k] = formatValue(ds, k, v);
  return {
    ccn: r.ccn,
    name: r.name,
    city: r.city,
    state: r.state,
    year: r.year,
    fiscal_period: `${r.fy_begin} to ${r.fy_end}`,
    facility_type: r.facility_type_desc,
    provider_type: r.provider_type_desc,
    ownership: `${r.ownership} (${r.control_desc})`,
    urban_rural: r.urban_rural,
    beds: num(r, "beds"),
    bed_band: r.bed_band,
    full_year_report: r.full_year,
    financials: {
      net_patient_revenue: num(r, "net_patient_revenue"),
      operating_expense: num(r, "operating_expense"),
      net_income: num(r, "net_income"),
      total_assets: num(r, "total_assets"),
      fte: num(r, "fte"),
      discharges: num(r, "discharges"),
      adjusted_discharges: num(r, "adj_discharges"),
      patient_days: num(r, "total_days"),
    },
    kpis,
    kpis_formatted: kpisFormatted,
    data_quality_flags: String(r.dq_flags).split(",").filter(Boolean),
    source: sourceCitation(r, ["Net Patient Revenue", "Less Total Operating Expense", "Net Income"]),
  };
}

export function profileWithYears(ds: Dataset, ccn: string, year?: number | null) {
  const p = profile(ds, ccn, year);
  return { ...p, available_years: ds.byCcn.get(p.ccn)!.map((r) => r.year) };
}

/* --------------------------------------------------------------------- peer groups */

export interface PeerGroup {
  dims: [string, string][];
  requested: string[];
  relaxed: string[];
  frame: Row[];
}

export function peerGroup(ds: Dataset, row: Row, dims?: string[] | null, minPeers = MIN_PEERS): PeerGroup {
  const requested = (dims && dims.length ? dims : DEFAULT_PEER_DIMS).filter((d) => d in PEER_DIMENSIONS);
  const active = [...requested];
  const yearRows = (ds.byYear.get(row.year) ?? []).filter((r) => r.full_year && r.ccn !== row.ccn);
  const relaxed: string[] = [];
  let frame: Row[];
  for (;;) {
    frame = yearRows.filter((r) => active.every((d) => r[d] === row[d]));
    if (frame.length >= minPeers || !active.length) break;
    const drop = RELAX_ORDER.find((d) => active.includes(d)) ?? active.at(-1)!;
    active.splice(active.indexOf(drop), 1);
    relaxed.push(drop);
  }
  return { dims: active.map((d) => [d, String(row[d])]), requested, relaxed, frame };
}

export function describePeers(pg: PeerGroup): string {
  return pg.dims.length ? pg.dims.map(([d, v]) => `${PEER_DIMENSIONS[d]} = ${v}`).join(", ") : "all hospitals";
}

function values(frame: Row[], key: string): number[] {
  const out: number[] = [];
  for (const r of frame) {
    const v = num(r, key);
    if (v !== null) out.push(v);
  }
  return out;
}

/* --------------------------------------------------------------------- benchmark */

function status(ds: Dataset, key: string, value: number | null, p25: number | null, p75: number | null): string {
  if (value === null || p25 === null || p75 === null) return "insufficient data";
  const k = ds.kpiByKey.get(key)!;
  if (p25 <= value && value <= p75) return "in line with peers";
  const above = value > p75;
  if (k.direction === null) return above ? "above peer range" : "below peer range";
  const good = k.direction === "higher" ? above : !above;
  return good ? "better than peers" : "worse than peers";
}

export function benchmark(ds: Dataset, ccn: string, year?: number | null, peerDims?: string[] | null, kpis?: string[] | null) {
  const r = mustRow(ds, ccn, year);
  const pg = peerGroup(ds, r, peerDims);
  const keys = kpis && kpis.length ? kpis : ds.kpis.map((k) => k.key);
  const rows = [];
  for (const key of keys) {
    const k = ds.kpiByKey.get(key);
    if (!k) continue;
    const value = num(r, key);
    const peers = values(pg.frame, key);
    let p25: number | null = null;
    let med: number | null = null;
    let p75: number | null = null;
    let pct: number | null = null;
    if (peers.length >= 3) {
      [p25, med, p75] = npPercentile(peers, [25, 50, 75]);
      if (value !== null) {
        let lt = 0;
        let eq = 0;
        for (const p of peers) {
          if (p < value) lt++;
          else if (p === value) eq++;
        }
        pct = (lt / peers.length) * 100 + (eq / peers.length) * 50;
      }
    }
    rows.push({
      kpi: key,
      label: k.label,
      category: k.category,
      value,
      value_fmt: formatValue(ds, key, value),
      peer_median: med,
      peer_median_fmt: formatValue(ds, key, med),
      peer_p25: p25,
      peer_p75: p75,
      peer_range_fmt: `${formatValue(ds, key, p25)} to ${formatValue(ds, key, p75)}`,
      percentile: pct === null ? null : pyRound(pct, 1),
      peers_with_data: peers.length,
      direction: k.direction,
      status: status(ds, key, value, p25, p75),
    });
  }
  const fieldSet = new Set<string>();
  for (const key of keys) ds.kpiByKey.get(key)?.fields.forEach((f) => fieldSet.add(f));
  return {
    hospital: { ccn: r.ccn, name: r.name, state: r.state, year: r.year, beds: num(r, "beds"), facility_type: r.facility_type_desc },
    peer_group: {
      definition: describePeers(pg),
      n_hospitals: pg.frame.length,
      requested: pg.requested,
      relaxed_dimensions: pg.relaxed,
      note: "Peers are other hospitals with full-year reports in the same year.",
    },
    kpis: rows,
    source: sourceCitation(r, [...fieldSet].sort(pyStringCompare)),
  };
}

/** Python's default string ordering (code point order), not localeCompare. */
export function pyStringCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* --------------------------------------------------------------------- opportunities */

export function opportunities(ds: Dataset, ccn: string, year?: number | null, peerDims?: string[] | null, target = "median", contractPremium = 0.25) {
  const r = mustRow(ds, ccn, year);
  const pg = peerGroup(ds, r, peerDims);
  const q = target === "median" ? 50 : 25;
  const tgt = (key: string, higherBetter = false): number | null => {
    const s = values(pg.frame, key);
    if (s.length < 3) return null;
    return npPercentile(s, [higherBetter ? 100 - q : q])[0];
  };
  const pd = num(r, "period_days");
  const period = pd !== null ? pd : 365.0;
  const annualize = period > 0 ? 365.0 / period : 1.0;
  const fv = (k: string, v: number | null) => formatValue(ds, k, v);
  const out: { area: string; kpi: string; current: string; target: string; annual_impact_usd: number | null; impact_type: string; formula: string; assumptions: string }[] = [];

  let v = num(r, "opex_per_adj_discharge");
  let t = tgt("opex_per_adj_discharge");
  const adj = num(r, "adj_discharges");
  if (v && t && adj && v > t) {
    out.push({ area: "Unit cost", kpi: "opex_per_adj_discharge", current: fv("opex_per_adj_discharge", v), target: fv("opex_per_adj_discharge", t),
      annual_impact_usd: (v - t) * adj * annualize, impact_type: "cost savings",
      formula: "(current - target cost per adjusted discharge) x adjusted discharges",
      assumptions: "Volume held constant. Some gap may reflect case mix, teaching, or service lines that peers lack." });
  }

  v = num(r, "fte_per_adj_occupied_bed");
  t = tgt("fte_per_adj_occupied_bed");
  const fte = num(r, "fte");
  const sal = num(r, "salaries");
  if (v && t && fte && sal && v > t) {
    const excessFte = fte * (1 - t / v);
    out.push({ area: "Staffing productivity", kpi: "fte_per_adj_occupied_bed", current: fv("fte_per_adj_occupied_bed", v), target: fv("fte_per_adj_occupied_bed", t),
      annual_impact_usd: excessFte * (sal / fte) * annualize, impact_type: "cost savings",
      formula: "FTEs above target x average salary per FTE (Total Salaries / FTEs)",
      assumptions: `About ${pyComma(excessFte, 0)} FTEs above target. Achieved over time through attrition and scheduling, not layoffs. Excludes benefits.` });
  }

  v = num(r, "contract_labor_ratio");
  t = tgt("contract_labor_ratio");
  if (v !== null && t !== null && sal && v > t) {
    const excess = (v - t) * sal;
    out.push({ area: "Contract labor", kpi: "contract_labor_ratio", current: fv("contract_labor_ratio", v), target: fv("contract_labor_ratio", t),
      annual_impact_usd: excess * contractPremium * annualize, impact_type: "cost savings",
      formula: `(current - target ratio) x salaries x ${pyPercent0(contractPremium)} contract premium`,
      assumptions: `Assumes converting excess contract labor to employed staff saves ${pyPercent0(contractPremium)} of that spend.` });
  }

  v = num(r, "days_in_ar");
  t = tgt("days_in_ar");
  const npr = num(r, "net_patient_revenue");
  if (v && t && npr && v > t) {
    out.push({ area: "Revenue cycle", kpi: "days_in_ar", current: fv("days_in_ar", v), target: fv("days_in_ar", t),
      annual_impact_usd: ((v - t) * npr) / period, impact_type: "one-time cash release",
      formula: "(current - target days in A/R) x daily net patient revenue",
      assumptions: "A one-time working capital improvement, not recurring profit." });
  }

  v = num(r, "alos");
  t = tgt("alos");
  const apDis = num(r, "ap_discharges");
  if (v && t && apDis && v > t) {
    const freed = (v - t) * apDis;
    out.push({ area: "Length of stay", kpi: "alos", current: fv("alos", v), target: fv("alos", t), annual_impact_usd: null, impact_type: "capacity",
      formula: "(current - target ALOS) x discharges = bed days freed",
      assumptions: `Frees about ${pyComma(freed * annualize, 0)} bed days a year (about ${pyComma(freed / period, 1)} staffed beds). Not case-mix adjusted; value depends on whether freed beds are refilled.` });
  }

  v = num(r, "npr_per_adj_discharge");
  t = tgt("npr_per_adj_discharge", true);
  if (v && t && adj && v < t) {
    out.push({ area: "Revenue yield", kpi: "npr_per_adj_discharge", current: fv("npr_per_adj_discharge", v), target: fv("npr_per_adj_discharge", t),
      annual_impact_usd: (t - v) * adj * annualize, impact_type: "revenue upside",
      formula: "(target - current net revenue per adjusted discharge) x adjusted discharges",
      assumptions: "Largely driven by payer mix and contracts. Treat as an upper bound." });
  }

  const items = out
    .map((o) => ({ ...o, annual_impact_fmt: o.annual_impact_usd !== null ? formatUsd(o.annual_impact_usd) : "n/a" }))
    .sort((a, b) => -(a.annual_impact_usd || 0) - -(b.annual_impact_usd || 0));
  const byArea = new Map(items.map((o) => [o.area, o.annual_impact_usd || 0]));
  const labor = (byArea.get("Staffing productivity") ?? 0) + (byArea.get("Contract labor") ?? 0);
  const recurring = Math.max(byArea.get("Unit cost") ?? 0, labor);
  return {
    hospital: { ccn: r.ccn, name: r.name, year: r.year },
    target: target === "median" ? "peer median" : "peer top quartile",
    peer_group: { definition: describePeers(pg), n_hospitals: pg.frame.length },
    opportunities: items,
    total_recurring_cost_savings_usd: recurring,
    total_recurring_cost_savings_fmt: formatUsd(recurring),
    total_note: "Recurring cost savings = the larger of the unit-cost gap and the labor gaps, because labor gaps are part of unit cost. Cash release and revenue upside are reported separately.",
    caveat: "Benchmarks show where to look, not what to cut. Validate each gap against case mix and service mix before setting targets.",
    source: sourceCitation(r, ["Less Total Operating Expense", "FTE - Employees on Payroll", "Total Salaries From Worksheet A", "Contract Labor: Direct Patient Care", "Accounts Receivable", "Net Patient Revenue"]),
  };
}

/* --------------------------------------------------------------------- trend */

export function trend(ds: Dataset, ccn: string, kpis?: string[] | null, peerDims?: string[] | null) {
  const hist = ds.byCcn.get(String(ccn).trim().padStart(6, "0"));
  if (!hist?.length) throw new NotFoundError(`No cost reports found for CCN ${ccn}.`);
  const keys = (kpis && kpis.length ? kpis : ["operating_margin", "opex_per_adj_discharge", "npr_per_adj_discharge", "occupancy_rate", "alos", "fte_per_adj_occupied_bed"]).filter((k) => ds.kpiByKey.has(k));
  const series = hist.map((r) => {
    const pg = peerGroup(ds, r, peerDims);
    const point: Record<string, number | boolean | null> = { year: r.year, full_year_report: r.full_year };
    for (const k of keys) {
      point[k] = num(r, k);
      point[`${k}_peer_median`] = median(values(pg.frame, k));
    }
    return point;
  });
  const change: Record<string, unknown> = {};
  const first = series[0];
  const last = series.at(-1)!;
  for (const k of keys) {
    const a = first[k] as number | null;
    const b = last[k] as number | null;
    if (a !== null && b !== null && first.year !== last.year) {
      const delta = b - a;
      const unit = ds.kpiByKey.get(k)!.unit;
      change[k] = {
        from_year: first.year, to_year: last.year, from: a, to: b, change: delta,
        change_fmt: unit === "pct" ? `${pySigned(delta * 100, 1)} percentage points` : `${pySigned(a ? (delta / a) * 100 : 0, 1)}%`,
      };
    }
  }
  const r0 = hist.at(-1)!;
  const fieldSet = new Set<string>();
  for (const k of keys) ds.kpiByKey.get(k)!.fields.forEach((f) => fieldSet.add(f));
  return { hospital: { ccn: r0.ccn, name: r0.name }, kpis: keys, series, change, source: sourceCitation(r0, [...fieldSet].sort(pyStringCompare)) };
}

/* --------------------------------------------------------------------- scenario */

export function scenario(ds: Dataset, ccn: string, year: number | null | undefined, volumeChangePct = 0, rateChangePct = 0, opexChangePct = 0, laborCostChangePct = 0, variableCostShare = 0.35) {
  const r = mustRow(ds, ccn, year);
  const npr = num(r, "net_patient_revenue");
  const opex = num(r, "operating_expense");
  const sal = num(r, "salaries") || 0.0;
  if (!npr || !opex) throw new NotFoundError("Net patient revenue or operating expense is missing for this report.");
  if (volumeChangePct <= -100 || rateChangePct <= -100) throw new InvalidInputError("Volume and payment rate changes must be greater than -100%.");
  const [vol, rate, oc, lc] = [volumeChangePct, rateChangePct, opexChangePct, laborCostChangePct].map((x) => x / 100.0);
  const newRev = npr * (1 + vol) * (1 + rate);
  const newOpex = opex + opex * variableCostShare * vol + sal * lc + opex * oc;
  const baseMargin = (npr - opex) / npr;
  const newMargin = (newRev - newOpex) / newRev;
  return {
    hospital: { ccn: r.ccn, name: r.name, year: r.year },
    inputs: { volume_change_pct: volumeChangePct, rate_change_pct: rateChangePct, opex_change_pct: opexChangePct, labor_cost_change_pct: laborCostChangePct, variable_cost_share: variableCostShare },
    baseline: { net_patient_revenue: npr, operating_expense: opex, operating_income: npr - opex, operating_margin: baseMargin, operating_margin_fmt: formatValue(ds, "operating_margin", baseMargin) },
    scenario: { net_patient_revenue: newRev, operating_expense: newOpex, operating_income: newRev - newOpex, operating_margin: newMargin, operating_margin_fmt: formatValue(ds, "operating_margin", newMargin) },
    delta: { operating_income: newRev - newOpex - (npr - opex), operating_income_fmt: formatUsd(newRev - newOpex - (npr - opex)), operating_margin_pp: (newMargin - baseMargin) * 100 },
    formula: "revenue = NPR x (1 + volume) x (1 + rate); expense = OpEx x (1 + variable_share x volume + opex_change) + salaries x labor_change",
    source: sourceCitation(r, ["Net Patient Revenue", "Less Total Operating Expense", "Total Salaries From Worksheet A"]),
  };
}

/* --------------------------------------------------------------------- rankings */

export function rank(ds: Dataset, kpi: string, year?: number | null, state?: string | null, facilityType?: string | null, minBeds = 0, topN = 10, bestFirst = true) {
  const k = ds.kpiByKey.get(kpi);
  if (!k) throw new NotFoundError(`Unknown KPI '${kpi}'. Options: ${ds.kpis.map((x) => x.key).join(", ")}`);
  topN = Math.max(1, Math.trunc(topN));
  const y = Number(year || ds.years.at(-1));
  const st = state ? state.toUpperCase() : null;
  const ft = facilityType ? facilityType.toUpperCase() : null;
  const pool = (ds.byYear.get(y) ?? []).filter(
    (r) => r.full_year && num(r, kpi) !== null && (num(r, "beds") ?? 0) >= minBeds && (!st || r.state === st) && (!ft || r.facility_type === ft),
  );
  const ascending = k.direction ? (k.direction === "lower") === bestFirst : !bestFirst;
  const sorted = [...pool].sort((a, b) => {
    const d = (num(a, kpi) as number) - (num(b, kpi) as number);
    if (d !== 0) return ascending ? d : -d;
    return pyStringCompare(a.ccn, b.ccn);
  });
  const results = sorted.slice(0, Math.trunc(topN)).map((r, i) => ({
    ccn: r.ccn, name: r.name, city: r.city, state: r.state, facility_type: r.facility_type, beds: num(r, "beds"),
    value: num(r, kpi) as number, rank: i + 1, value_fmt: formatValue(ds, kpi, num(r, kpi)),
  }));
  return {
    kpi, label: k.label, year: y, order: bestFirst ? "best first" : "worst first",
    filters: { state: state ?? null, facility_type: facilityType ?? null, min_beds: minBeds },
    hospitals_considered: pool.length, results,
    source: { dataset: SOURCE_NAME, year: y, fields: [...k.fields] },
  };
}

/* --------------------------------------------------------------------- insights */

export function insights(ds: Dataset, ccn: string, year?: number | null, peerDims?: string[] | null) {
  const b = benchmark(ds, ccn, year, peerDims);
  const o = opportunities(ds, ccn, year, peerDims);
  const directional = b.kpis.filter((r) => r.percentile !== null && r.direction);
  const goodness = (r: (typeof directional)[number]) => (r.direction === "higher" ? (r.percentile as number) : 100 - (r.percentile as number));
  const items: { kind: string; kpi: string; title: string; detail: string; ask: string }[] = [];
  for (const r of directional.filter((x) => x.status === "worse than peers").sort((a, c) => goodness(a) - goodness(c)).slice(0, 3)) {
    items.push({ kind: "risk", kpi: r.kpi, title: `${r.label} trails peers`,
      detail: `${r.value_fmt} vs peer median ${r.peer_median_fmt} (${ordinal(r.percentile as number)} percentile).`,
      ask: `Why is our ${r.label.toLowerCase()} worse than peers, and what would closing the gap be worth?` });
  }
  for (const r of directional.filter((x) => x.status === "better than peers").sort((a, c) => goodness(c) - goodness(a)).slice(0, 2)) {
    items.push({ kind: "strength", kpi: r.kpi, title: `${r.label} leads peers`,
      detail: `${r.value_fmt} vs peer median ${r.peer_median_fmt} (${ordinal(r.percentile as number)} percentile).`,
      ask: `How has our ${r.label.toLowerCase()} trended over time?` });
  }
  const sized = o.opportunities.filter((x) => x.annual_impact_usd);
  if (sized.length) {
    const top = sized[0];
    items.unshift({ kind: "opportunity", kpi: top.kpi, title: `${top.area}: ${top.annual_impact_fmt}`,
      detail: `${top.current} vs target ${top.target} (${top.impact_type}).`, ask: "What are our biggest savings opportunities?" });
  }
  return { hospital: b.hospital, peer_group: b.peer_group, insights: items };
}

/* --------------------------------------------------------------------- search (store.py) */

const STOP = new Set(["hospital", "medical", "center", "the", "of", "and", "health", "regional", "memorial", "inc"]);

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function bigrams(text: string): string[] {
  const t = text.trim().replace(/\s+/g, " ");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of x) {
    const c = pool.get(g) ?? 0;
    if (c > 0) {
      pool.set(g, c - 1);
      common++;
    }
  }
  return (2.0 * common) / (x.length + y.length);
}

const tokenCache = new WeakMap<Row, Set<string>>();
function rowTokens(r: Row): Set<string> {
  let t = tokenCache.get(r);
  if (!t) tokenCache.set(r, (t = new Set(tokens(r.name))));
  return t;
}

function record(r: Row) {
  const beds = num(r, "beds");
  return {
    ccn: r.ccn, name: r.name, city: r.city as string, state: r.state as string, facility_type: r.facility_type as string,
    facility_type_desc: r.facility_type_desc as string, beds: beds === null ? null : Math.trunc(beds), latest_year: r.year,
  };
}

export function search(ds: Dataset, query: string, state?: string | null, limit = 10) {
  let d = ds.directory;
  if (state) {
    const s = state.trim().toUpperCase();
    d = d.filter((r) => r.state === s);
  }
  const q = query.trim();
  if (/^\d{5,6}$/.test(q)) {
    const hit = d.filter((r) => r.ccn === q.padStart(6, "0"));
    if (hit.length) return hit.map(record);
  }
  const all = tokens(q);
  const qTokens = all.filter((t) => !STOP.has(t)).length ? all.filter((t) => !STOP.has(t)) : all;
  if (!qTokens.length) return [];
  const scored = d.map((r) => {
    const toks = rowTokens(r);
    const city = String(r.city).toLowerCase();
    let s = 0;
    for (const t of qTokens) {
      if (toks.has(t)) s += 2.0;
      else if (t.length >= 3 && [...toks].some((rt) => rt.startsWith(t))) s += 1.0;
      else if (city.includes(t)) s += 0.75;
    }
    return { r, s };
  });
  const best = scored.length ? Math.max(...scored.map((x) => x.s)) : 0;
  let hits = scored
    .filter((x) => x.s > 0 && x.s >= best * 0.6)
    .sort((a, b) => b.s - a.s || bedsDesc(a.r, b.r) || pyStringCompare(a.r.ccn, b.r.ccn))
    .map((x) => x.r);
  if (!hits.length) {
    const upper = q.toUpperCase();
    hits = d
      .map((r) => ({ r, sim: similarity(upper, r.name) }))
      .filter((x) => x.sim >= 0.6)
      .sort((a, b) => b.sim - a.sim || pyStringCompare(a.r.ccn, b.r.ccn))
      .map((x) => x.r);
  }
  return hits.slice(0, limit).map(record);
}

/** beds descending with missing values last (pandas na_position="last"). */
function bedsDesc(a: Row, b: Row): number {
  const x = num(a, "beds");
  const y = num(b, "beds");
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}
