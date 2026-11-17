/**
 * Decodes the exported hospital-year table (see src/hospital_ops_copilot/web_export.py) and indexes it.
 * Values are decoded exactly as Python's load_export does (integer / scale), so results match.
 */

export interface KpiDefLite {
  key: string;
  label: string;
  category: string;
  unit: "pct" | "usd" | "ratio" | "days" | "count";
  direction: "higher" | "lower" | null;
  formula: string;
  fields: string[];
  description: string;
}

export type Row = Record<string, number | string | boolean | null> & {
  ccn: string;
  year: number;
  name: string;
  full_year: boolean;
};

interface Export {
  version: number;
  rows: number;
  scale: Record<string, number>;
  columns: Record<string, (number | null)[] | { dict: string[]; idx: number[] }>;
}

export interface Dataset {
  rows: Row[];
  byCcn: Map<string, Row[]>;
  byYear: Map<number, Row[]>;
  years: number[];
  kpis: KpiDefLite[];
  kpiByKey: Map<string, KpiDefLite>;
  directory: Row[]; // latest row per hospital, in ccn order
}

export function decode(data: Export, kpis: KpiDefLite[]): Dataset {
  const n = data.rows;
  const rows: Row[] = Array.from({ length: n }, () => ({}) as Row);
  for (const [c, scale] of Object.entries(data.scale)) {
    const col = data.columns[c] as (number | null)[];
    for (let i = 0; i < n; i++) {
      const v = col[i];
      rows[i][c] = v === null ? null : v / scale;
    }
  }
  for (const [c, col] of Object.entries(data.columns)) {
    if (c in data.scale) continue;
    const { dict, idx } = col as { dict: string[]; idx: number[] };
    for (let i = 0; i < n; i++) rows[i][c] = dict[idx[i]];
  }
  for (const r of rows) r.full_year = (r.full_year as unknown) === 1;

  const byCcn = new Map<string, Row[]>();
  const byYear = new Map<number, Row[]>();
  for (const r of rows) {
    (byCcn.get(r.ccn) ?? byCcn.set(r.ccn, []).get(r.ccn)!).push(r);
    (byYear.get(r.year) ?? byYear.set(r.year, []).get(r.year)!).push(r);
  }
  for (const list of byCcn.values()) list.sort((a, b) => a.year - b.year);
  const directory = [...byCcn.keys()].sort().map((k) => byCcn.get(k)!.at(-1)!);
  const years = [...byYear.keys()].sort((a, b) => a - b);
  return { rows, byCcn, byYear, years, kpis, kpiByKey: new Map(kpis.map((k) => [k.key, k])), directory };
}

export function num(r: Row, key: string): number | null {
  const v = r[key];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}
