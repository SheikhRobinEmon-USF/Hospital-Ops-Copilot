/**
 * Parity: the in-browser engine must reproduce the Python analytics and offline analyst exactly.
 * Fixtures come from `hoc export-web --fixtures web/test-fixtures/parity.json` (Python, source of truth).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import * as A from "./analytics";
import { decode, type Dataset } from "./data";
import { DocIndex } from "./docs";
import { finalAnswer, offlineAnswer, Tools } from "./offline";
import { pyFixed } from "./pyfmt";

const root = resolve(__dirname, "../..");
const dataDir = resolve(root, "public/data");
const fixturesPath = resolve(root, "test-fixtures/parity.json");
const ready = existsSync(resolve(dataDir, "hospitals.json")) && existsSync(fixturesPath);
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

/** Deep equality with a tight relative tolerance for floats (summation order can differ in the last bits). */
function diff(actual: unknown, expected: unknown, path = "$"): string | null {
  if (typeof expected === "number" && typeof actual === "number") {
    const tol = Math.max(1e-12, Math.abs(expected) * 1e-9);
    return Math.abs(actual - expected) <= tol ? null : `${path}: ${actual} != ${expected}`;
  }
  if (expected === null || typeof expected !== "object") {
    return actual === expected ? null : `${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: not an array`;
    if (actual.length !== expected.length) return `${path}: length ${actual.length} != ${expected.length}`;
    for (let i = 0; i < expected.length; i++) {
      const d = diff(actual[i], expected[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (!actual || typeof actual !== "object") return `${path}: not an object`;
  const ek = Object.keys(expected).sort();
  const ak = Object.keys(actual).sort();
  if (ek.join() !== ak.join()) return `${path}: keys [${ak}] != [${ek}]`;
  for (const k of ek) {
    const d = diff((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

interface Case { fn: string; args: Record<string, unknown>; expected: unknown; error: string | null }

describe.skipIf(!ready)("parity with Python", () => {
  let ds: Dataset;
  let docs: DocIndex;
  let tools: Tools;
  let cases: Case[] = [];

  beforeAll(() => {
    ds = decode(read(resolve(dataDir, "hospitals.json")), read(resolve(dataDir, "kpis.json")));
    docs = new DocIndex(read(resolve(dataDir, "corpus.json")));
    tools = new Tools(ds, docs);
    cases = read(fixturesPath).cases;
  });

  const run = (c: Case): unknown => {
    const a = c.args as Record<string, never>;
    switch (c.fn) {
      case "profile": return A.profileWithYears(ds, a.ccn, a.year);
      case "benchmark": return A.benchmark(ds, a.ccn, a.year, a.peerDims);
      case "insights": return A.insights(ds, a.ccn, a.year, a.peerDims);
      case "opportunities": return A.opportunities(ds, a.ccn, a.year, a.peerDims, a.target);
      case "trend": return A.trend(ds, a.ccn, a.kpis, a.peerDims);
      case "scenario": return A.scenario(ds, a.ccn, a.year, a.volume_change_pct, a.rate_change_pct, a.opex_change_pct, a.labor_cost_change_pct, a.variable_cost_share);
      case "rank": return A.rank(ds, a.kpi, a.year, a.state, a.facility_type, a.min_beds, a.top_n, a.best_first);
      case "search": return A.search(ds, a.q, a.state, 12);
      case "docs": return docs.search(a.query, 3);
      case "ask": {
        const { text, results } = offlineAnswer(ds, tools, a.question, a.ccn);
        return finalAnswer(a.question, text, results);
      }
      default: throw new Error(`unknown fn ${c.fn}`);
    }
  };

  it("reproduces every Python fixture", () => {
    const failures: string[] = [];
    for (const c of cases) {
      try {
        const out = run(c);
        if (c.error) failures.push(`${c.fn} ${JSON.stringify(c.args)}: expected error "${c.error}"`);
        else {
          const d = diff(JSON.parse(JSON.stringify(out)), c.expected);
          if (d) failures.push(`${c.fn} ${JSON.stringify(c.args)}: ${d}`);
        }
      } catch (e) {
        if (!(c.error && e instanceof A.NotFoundError && e.message === c.error)) failures.push(`${c.fn} ${JSON.stringify(c.args)}: threw ${e}`);
      }
    }
    expect(cases.length).toBeGreaterThan(500);
    expect(failures.slice(0, 15), `${failures.length} of ${cases.length} cases differ`).toEqual([]);
  });
});

describe("python formatting", () => {
  it("rounds exact ties to even like Python", () => {
    expect(pyFixed(26.5, 0)).toBe("26");
    expect(pyFixed(27.5, 0)).toBe("28");
    expect(pyFixed(2.675, 2)).toBe("2.67");
    expect(pyFixed(-0.04, 1)).toBe("-0.0");
  });
});
