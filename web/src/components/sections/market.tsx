"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import { m } from "motion/react";
import { useState } from "react";

import { Card, ErrorState, Segmented, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useKpiDefs, useProfile } from "@/lib/queries";
import { cn, titleCase } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const TYPES = ["STH", "CAH", "PH", "RH", "LTCH", "CH"];

export function Market() {
  const profile = useProfile();
  const defs = useKpiDefs();
  const { year, set, ccn } = useWorkspace();
  const [kpi, setKpi] = useState("operating_margin");
  const [state, setState] = useState<string | null>(null);
  const [ftype, setFtype] = useState("STH");
  const [minBeds, setMinBeds] = useState(100);
  const [best, setBest] = useState(true);
  const st = state ?? profile.data?.state ?? "FL";
  const q = useQuery({
    queryKey: ["rank", kpi, year, st, ftype, minBeds, best],
    queryFn: () => api.rankings(kpi, { year, state: st === "US" ? undefined : st, facility_type: ftype, min_beds: minBeds, best_first: best, top_n: 25 }),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <ErrorState title="Could not load rankings" detail={String(q.error)} />;
  const values = q.data?.results.map((r) => r.value) ?? [];
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values, 0) || 1;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Market</h2>
        <p className="text-sm text-muted">Rank hospitals on any KPI. Click a row to open that hospital.</p>
      </div>
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <select value={kpi} onChange={(e) => setKpi(e.target.value)} className="h-9 rounded-lg bg-foreground/5 px-3 text-sm ring-1 ring-inset ring-border" aria-label="KPI">
          {defs.data?.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <input value={st} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))} className="h-9 w-20 rounded-lg bg-foreground/5 px-3 text-sm uppercase ring-1 ring-inset ring-border" aria-label="State (US for national)" title="Two-letter state, or US for national" />
        <Segmented layoutId="mk-type" size="sm" value={ftype} onChange={setFtype} options={TYPES.map((t) => ({ value: t, label: t }))} />
        <label className="flex items-center gap-2 text-sm text-muted">
          Min beds
          <input type="number" min={0} step={25} value={minBeds} onChange={(e) => setMinBeds(Number(e.target.value))} className="h-9 w-20 rounded-lg bg-foreground/5 px-3 text-sm text-foreground ring-1 ring-inset ring-border" />
        </label>
        <div className="ml-auto"><Segmented layoutId="mk-order" size="sm" value={best ? "best" : "worst"} onChange={(v) => setBest(v === "best")} options={[{ value: "best", label: "Best" }, { value: "worst", label: "Worst" }]} /></div>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-2.5 text-xs text-muted">
          {q.data ? `${q.data.label} · ${q.data.year} · ${q.data.hospitals_considered} hospitals meet the filters` : "Loading..."}
        </div>
        {q.isPending ? (
          <div className="space-y-2 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : (
          <ul className={cn("divide-y divide-border transition-opacity", q.isFetching && "opacity-70")}>
            {q.data?.results.map((r, i) => (
              <m.li key={r.ccn} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.015 }}>
                <button
                  onClick={() => set({ ccn: r.ccn, section: "overview" })}
                  className={cn("group grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 px-5 py-2.5 text-left text-sm transition hover:bg-foreground/[0.04] md:grid-cols-[2rem_minmax(200px,1fr)_minmax(120px,1fr)_6rem]", r.ccn === ccn && "bg-[var(--accent)]/[0.07]")}
                >
                  <span className="tabular text-xs text-muted">{r.rank}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{titleCase(r.name)}</span>
                    <span className="block truncate text-xs text-muted">{r.city}, {r.state} · {r.beds ?? "?"} beds</span>
                  </span>
                  <span className="hidden h-2 rounded-full bg-foreground/[0.06] md:block">
                    <span className="block h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" style={{ width: `${Math.max(2, ((r.value - lo) / (hi - lo)) * 100)}%` }} />
                  </span>
                  <span className="tabular flex items-center justify-end gap-1 font-semibold">
                    {r.value_fmt}
                    <ArrowUpRight className="size-3.5 text-muted opacity-0 transition group-hover:opacity-100" />
                  </span>
                </button>
              </m.li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">Extreme values can reflect reporting differences, such as costs booked at a health system&apos;s home office.</p>
    </div>
  );
}
