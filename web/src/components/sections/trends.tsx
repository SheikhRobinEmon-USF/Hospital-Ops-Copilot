"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { useKpiDefs, useTrend } from "@/lib/queries";
import { cn, formatKpi } from "@/lib/utils";

// Recharts is the heaviest client dependency; load it only when this view opens.
const TrendChart = dynamic(() => import("@/components/charts/trend-chart"), { ssr: false, loading: () => <Skeleton className="h-80" /> });

const KEYS = ["operating_margin", "total_margin", "opex_per_adj_discharge", "npr_per_adj_discharge", "fte_per_adj_occupied_bed", "contract_labor_ratio", "occupancy_rate", "alos", "days_in_ar", "days_cash_on_hand"];

export function Trends() {
  const [kpi, setKpi] = useState("operating_margin");
  const defs = useKpiDefs();
  const trend = useTrend(KEYS);
  const def = defs.data?.find((d) => d.key === kpi);
  if (trend.isError) return <ErrorState title="Could not load trends" detail={String(trend.error)} />;
  const data = (trend.data?.series ?? []).map((p) => ({ year: `FY${String(p.year).slice(2)}`, hospital: p[kpi] as number | null, peer: p[`${kpi}_peer_median`] as number | null }));
  const change = trend.data?.change[kpi];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Trends</h2>
        <p className="text-sm text-muted">Each cost report year against that year&apos;s peer median.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="KPI">
        {KEYS.map((k) => {
          const d = defs.data?.find((x) => x.key === k);
          const c = trend.data?.change[k];
          return (
            <button
              key={k}
              role="tab"
              aria-selected={k === kpi}
              onClick={() => setKpi(k)}
              className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset transition", k === kpi ? "bg-[var(--accent)] text-white ring-transparent shadow-md shadow-[var(--accent)]/25" : "ring-border text-muted hover:text-foreground hover:bg-foreground/5")}
            >
              {d?.label ?? k}
              {c && <span className="ml-1.5 opacity-70">{c.change_fmt.replace(" percentage points", " pts")}</span>}
            </button>
          );
        })}
      </div>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{def?.label}</h3>
          {change && (
            <p className="tabular text-sm text-muted">
              {formatKpi(def?.unit, change.from)} in {change.from_year} → <span className="font-semibold text-foreground">{formatKpi(def?.unit, change.to)}</span> in {change.to_year} ({change.change_fmt})
            </p>
          )}
        </div>
        {trend.isPending ? <Skeleton className="h-80" /> : <TrendChart data={data} unit={def?.unit ?? "ratio"} label={def?.label ?? kpi} />}
        <div className="mt-3 flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded bg-[var(--accent)]" />This hospital</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-[var(--chart-2)]" />Peer median</span>
        </div>
        {def && <p className="mt-4 text-xs leading-relaxed text-muted">{def.description} <span className="font-mono text-[11px]">{def.formula}</span></p>}
      </Card>
    </div>
  );
}
