/** Port of src/hospital_ops_copilot/llm/grounding.py: trace every number in an answer to tool output. */

import { pyRound } from "./pyfmt";

const NUM = /(?<neg>[-−])?(?<cur>\$)?(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(?<suf>%|percent(?:age points?)?|pp\b|points?\b|[kKmMbB]\b|million\b|billion\b|thousand\b)?/g;
const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };
const STR_NUM = /-?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|[KMB]\b| days)?/g;
const MONTHS = "(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)";
const DATE_BEFORE = new RegExp(`${MONTHS}\\.?\\s+$`, "i");
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

export interface GroundingReport {
  numbers_checked: number;
  numbers_grounded: number;
  score: number;
  ungrounded: string[];
}

function parseStrNumber(s: string): number | null {
  NUM.lastIndex = 0;
  const m = NUM.exec(s);
  NUM.lastIndex = 0;
  if (!m?.groups) return null;
  let v = parseFloat(m.groups.num.replaceAll(",", ""));
  if (m.groups.neg) v = -v;
  const suf = (m.groups.suf ?? "").toLowerCase();
  if (suf in SCALE) v *= SCALE[suf];
  if (suf === "%") v /= 100;
  return v;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

function collect(obj: unknown, out: number[]): void {
  if (typeof obj === "boolean" || obj === null || obj === undefined) return;
  if (isNumber(obj)) {
    out.push(obj);
    return;
  }
  if (typeof obj === "string") {
    for (const m of obj.matchAll(STR_NUM)) {
      const v = parseStrNumber(m[0]);
      if (v !== null) out.push(v);
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collect(v, out);
    return;
  }
  if (typeof obj === "object") {
    const vals = Object.values(obj as Record<string, unknown>);
    const siblings: number[] = [];
    for (const v of vals) {
      if (isNumber(v)) siblings.push(v);
      else if (typeof v === "string" && v.length < 40) {
        const p = parseStrNumber(v);
        if (p !== null) siblings.push(p);
      }
    }
    if (siblings.length > 1 && siblings.length <= 12) {
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          out.push(siblings[i] - siblings[j]);
          out.push(siblings[j] - siblings[i]);
        }
      }
    }
    for (const v of vals) collect(v, out);
  }
}

export function isDateContext(answer: string, start: number): boolean {
  if (DATE_BEFORE.test(answer.slice(Math.max(0, start - 12), start))) return true;
  for (const m of answer.matchAll(ISO_DATE)) {
    if (m.index! <= start && start < m.index! + m[0].length) return true;
  }
  return false;
}

function skip(text: string, value: number, start: number, answer: string): boolean {
  if (isDateContext(answer, start)) return true;
  const raw = text.trim().replace(/^[$\-−]+/, "");
  if (/^(19|20)\d\d$/.test(raw)) return true;
  if (/^\d{6}$/.test(raw)) return true;
  const lineStart = answer.lastIndexOf("\n", start - 1) + 1;
  const prefix = answer.slice(lineStart, start).trim();
  if (["", "-", "*"].includes(prefix) && /^\d+[.)]/.test(answer.slice(start, start + 4))) return true;
  if (!raw.includes(".") && !raw.includes(",") && Math.abs(value) <= 12 && !text.includes("%") && !text.includes("$")) return true;
  return false;
}

function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function check(answer: string, toolData: unknown[], relTol = 0.001): GroundingReport {
  const ev: number[] = [];
  for (const d of toolData) collect(d, ev);
  const reps = new Set<number>();
  for (const e of ev) for (const f of [1, 100, 1e-3, 1e-6, 1e-9]) reps.add(pyRound(e * f, 6));
  const sorted = [...reps].sort((a, b) => a - b);
  const claims: { text: string; grounded: boolean }[] = [];
  for (const m of answer.matchAll(NUM)) {
    const g = m.groups!;
    const text = m[0];
    const numStr = g.num.replaceAll(",", "");
    let v = parseFloat(numStr);
    if (g.neg) v = -v;
    if (skip(text, v, m.index!, answer)) continue;
    const suf = (g.suf ?? "").toLowerCase();
    const scale = SCALE[suf] ?? 1;
    const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;
    const displayTol = 0.5 * 10 ** -decimals + 1e-9;
    const target = v * scale;
    const tolAbs = displayTol * scale;
    const ok = [target, Math.abs(target)].some((cand) => {
      const tol = Math.max(tolAbs, Math.abs(cand) * relTol);
      const i = lowerBound(sorted, cand - tol);
      return i < sorted.length && sorted[i] <= cand + tol;
    });
    claims.push({ text: text.trim(), grounded: ok });
  }
  const grounded = claims.filter((c) => c.grounded).length;
  const score = claims.length ? grounded / claims.length : 1.0;
  return { numbers_checked: claims.length, numbers_grounded: grounded, score: pyRound(score, 3), ungrounded: claims.filter((c) => !c.grounded).map((c) => c.text) };
}
