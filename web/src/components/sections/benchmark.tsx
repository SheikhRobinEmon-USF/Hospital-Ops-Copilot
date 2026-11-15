"use client";

import { Sparkles } from "lucide-react";
import { m } from "motion/react";
import { useMemo, useState } from "react";

import { PercentileStrip } from "@/components/charts/percentile-strip";
import { Button, Card, ErrorState, Segmented, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import type { KpiRow, Status } from "@/lib/api";
import { useBenchmark, useKpiDefs } from "@/lib/queries";
import { STATUS_STYLE } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

type Filter = "all" | "flagged" | "better";

export function Benchmark() {
  const bm = useBenchmark();
  const defs = useKpiDefs();
  const { askCopilot } = useWorkspace();
  const [filter, setFilter] = useState<Filter>("all");
  const defByKey = Object.fromEntries((defs.data ?? []).map((d) => [d.key, d]));

  const groups = useMemo(() => {
    const rows = (bm.data?.kpis ?? []).filter((r) => {
      if (filter === "flagged") return r.status === "worse than peers" || r.status === "above peer range" || r.status === "below peer range";
      if (filter === "better") return r.status === "better than peers";
      return true;
    });
    const out = new Map<string, KpiRow[]>();
    rows.forEach((r) => out.set(r.category, [...(out.get(r.category) ?? []), r]));
    return [...out.entries()];
  }, [bm.data, filter]);

  if (bm.isError) return <ErrorState title="Could not load benchmarks" detail={String(bm.error)} />;
  const counts = (bm.data?.kpis ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Peer benchmark</h2>
          <p className="text-sm text-muted">
            {bm.data ? `${bm.data.peer_group.n_hospitals} peers: ${bm.data.peer_group.definition}. ` : ""}
            Band = 25th to 75th percentile, tick = median.
          </p>
          {bm.data?.peer_group.relaxed_dimensions?.length ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Widened to reach 10 peers (dropped {bm.data.peer_group.relaxed_dimensions.join(", ")}).</p>
          ) : null}
        </div>
        <Segmented
          layoutId="bm-filter"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All ${bm.data?.kpis.length ?? ""}` },
            { value: "flagged", label: `Outside range ${(counts["worse than peers"] ?? 0) + (counts["above peer range"] ?? 0) + (counts["below peer range"] ?? 0)}` },
            { value: "better", label: `Better ${counts["better than peers"] ?? 0}` },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted">
        {(Object.keys(STATUS_STYLE) as Status[]).filter((s) => s !== "insufficient data").map((s) => (
          <span key={s} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${STATUS_STYLE[s].dot}`} />{STATUS_STYLE[s].label}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-gradient-to-r from-transparent to-emerald-500/40" />Favorable direction</span>
      </div>

      {bm.isPending ? (
        <Skeleton className="h-[480px]" />
      ) : (
        groups.map(([category, rows]) => (
          <Card key={category} className="overflow-hidden">
            <div className="border-b border-border px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted">{category}</div>
            <ul className="divide-y divide-border">
              {rows.map((r, i) => (
                <m.li
                  key={r.kpi}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="group grid grid-cols-1 items-center gap-x-6 gap-y-2 px-5 py-3 md:grid-cols-[minmax(240px,1.3fr)_minmax(180px,2fr)_auto]"
                >
                  <div className="min-w-0">
                    <Tooltip content={<><p>{defByKey[r.kpi]?.description}</p><p className="mt-1.5 font-mono text-[10px] text-muted">{defByKey[r.kpi]?.formula}</p></>}>
                      <p className="cursor-help truncate text-sm font-medium">{r.label}</p>
                    </Tooltip>
                    <p className="tabular text-xs text-muted">
                      <span className="font-semibold text-foreground">{r.value_fmt}</span> · median {r.peer_median_fmt} · IQR {r.peer_range_fmt}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-8 text-right text-[10px] text-muted">{r.direction === "lower" ? "better" : "low"}</span>
                    <PercentileStrip row={r} />
                    <span className="w-8 text-[10px] text-muted">{r.direction === "lower" ? "worse" : r.direction === "higher" ? "better" : "high"}</span>
                  </div>
                  <div className="flex items-center gap-2 md:justify-end">
                    <span className="tabular w-12 text-right text-xs text-muted">{r.percentile === null ? "n/a" : `P${Math.round(r.percentile)}`}</span>
                    <StatusBadge status={r.status} className="w-32 justify-center" />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ask copilot about ${r.label}`}
                      className="size-7 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => askCopilot(`Explain our ${r.label.toLowerCase()} versus peers and what drives it.`)}
                    >
                      <Sparkles className="text-[var(--accent)]" />
                    </Button>
                  </div>
                </m.li>
              ))}
            </ul>
          </Card>
        ))
      )}
      <p className="text-xs text-muted">Benchmarks are not adjusted for case mix. Percentile = share of peers with a lower value.</p>
    </div>
  );
}
