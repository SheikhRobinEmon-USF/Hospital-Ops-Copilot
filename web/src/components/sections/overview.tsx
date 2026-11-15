"use client";

import { AlertTriangle, ArrowRight, BadgeDollarSign, Info, Sparkles, TrendingUp } from "lucide-react";
import { m } from "motion/react";

import { Sparkline } from "@/components/charts/sparkline";
import { AnimatedNumber, Card, CardHeader, ErrorState, Pill, Skeleton, StatusBadge } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import type { Insight, KpiDef, KpiRow } from "@/lib/api";
import { useBenchmark, useInsights, useKpiDefs, useProfile, useTrend } from "@/lib/queries";
import { cn, formatKpi, titleCase, usd } from "@/lib/utils";
import { HEADLINE_KPIS } from "@/lib/prefetch";
import { useWorkspace } from "@/lib/workspace";

export const HEADLINE = HEADLINE_KPIS;

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const rise = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.2, 0.7, 0.2, 1] as const } } };

export function HospitalHeader() {
  const { data: p, isPending } = useProfile();
  const bm = useBenchmark();
  if (isPending || !p) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-9 w-96 max-w-full md:h-10" />
        <Skeleton className="h-6 w-[36rem] max-w-full" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>CCN {p.ccn}</span>·<span>Cost report {p.year}</span>·<span>{p.fiscal_period.replace(" to ", " → ")}</span>
        {!p.full_year_report && <Pill className="text-amber-600 dark:text-amber-400">Partial-year report</Pill>}
      </div>
      <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">{titleCase(p.name)}</h1>
      <div className="flex flex-wrap gap-1.5">
        <Pill>{p.city}, {p.state}</Pill>
        <Pill>{p.facility_type}</Pill>
        <Pill>{p.beds ?? "?"} beds</Pill>
        <Pill>{p.ownership.split(" (")[0]}</Pill>
        <Tooltip content="Medicare's urban/rural indicator from the cost report. Some city hospitals reclassify as rural for payment purposes.">
          <span><Pill>{p.urban_rural}</Pill></span>
        </Tooltip>
        {bm.data && (
          <Pill className="bg-[var(--accent)]/10 text-[var(--accent)] ring-[var(--accent)]/25">
            {bm.data.peer_group.n_hospitals} peers: {bm.data.peer_group.definition}
          </Pill>
        )}
      </div>
      {p.data_quality_flags.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5" /> Data quality flags: {p.data_quality_flags.join(", ")}. Flagged values are excluded as implausible.
        </p>
      )}
    </div>
  );
}

export function KpiCard({ row, def, spark, peerSpark }: { row: KpiRow; def?: KpiDef; spark?: (number | null)[]; peerSpark?: (number | null)[] }) {
  const unit = def?.unit ?? "ratio";
  const diff = row.value !== null && row.peer_median !== null ? row.value - row.peer_median : null;
  const good = diff === null || row.direction === null ? null : row.direction === "higher" ? diff >= 0 : diff <= 0;
  const diffText =
    diff === null ? "" : unit === "pct" ? `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)} pts` : `${diff >= 0 ? "+" : "-"}${formatKpi(unit, Math.abs(diff))}`;
  return (
    <m.div variants={rise}>
      <Card className="group h-full p-4 transition hover:shadow-lg hover:shadow-[var(--accent)]/5">
        <div className="flex items-start justify-between gap-2">
          <Tooltip content={<><p className="font-medium">{row.label}</p><p className="mt-1 text-muted">{def?.description}</p><p className="mt-1.5 font-mono text-[10px] text-muted">{def?.formula}</p></>}>
            <p className="line-clamp-2 flex cursor-help items-center gap-1 text-xs font-medium text-muted">
              {row.label} <Info className="size-3 opacity-0 transition group-hover:opacity-100" />
            </p>
          </Tooltip>
          <StatusBadge status={row.status} />
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div>
            <AnimatedNumber value={row.value} format={(v) => formatKpi(unit, v)} className="text-2xl font-semibold tracking-tight" />
            <p className="mt-1 text-xs text-muted">
              <span className={cn("font-medium", good === null ? "" : good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{diffText}</span>
              {diffText && " vs median "}
              <span className="tabular">{row.peer_median_fmt}</span>
            </p>
          </div>
          {spark && <Sparkline values={spark} peer={peerSpark} width={96} height={34} />}
        </div>
      </Card>
    </m.div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const { askCopilot } = useWorkspace();
  const tone = {
    opportunity: { icon: <BadgeDollarSign />, ring: "from-[var(--accent)]/25", color: "text-[var(--accent)]" },
    risk: { icon: <AlertTriangle />, ring: "from-rose-500/25", color: "text-rose-500" },
    strength: { icon: <TrendingUp />, ring: "from-emerald-500/25", color: "text-emerald-500" },
  }[insight.kind];
  return (
    <m.button
      variants={rise}
      whileHover={{ y: -2 }}
      onClick={() => askCopilot(insight.ask)}
      className="group relative overflow-hidden rounded-2xl p-px text-left"
    >
      <span className={cn("absolute inset-0 bg-gradient-to-br to-transparent", tone.ring)} />
      <span className="glass relative flex h-full flex-col gap-2 rounded-[15px] p-4">
        <span className={cn("flex items-center gap-2 text-xs font-medium uppercase tracking-wider [&_svg]:size-3.5", tone.color)}>
          {tone.icon}
          {insight.kind}
        </span>
        <span className="text-sm font-semibold leading-snug">{insight.title}</span>
        <span className="text-xs leading-relaxed text-muted">{insight.detail}</span>
        <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-[var(--accent)]">
          <Sparkles className="size-3.5" /> Ask copilot
          <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
        </span>
      </span>
    </m.button>
  );
}

export function Overview() {
  const bm = useBenchmark();
  const defs = useKpiDefs();
  const insights = useInsights();
  const profile = useProfile();
  const trend = useTrend(HEADLINE);
  const defByKey = Object.fromEntries((defs.data ?? []).map((d) => [d.key, d]));

  if (bm.isError) return <ErrorState title="Could not load benchmarks" detail={String(bm.error)} />;
  const rows = bm.data ? HEADLINE.map((k) => bm.data!.kpis.find((r) => r.kpi === k)).filter(Boolean) as KpiRow[] : [];
  const f = profile.data?.financials;

  return (
    <div className="space-y-8">
      <section aria-label="Financial summary" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Net patient revenue", f?.net_patient_revenue],
          ["Operating expense", f?.operating_expense],
          ["Net income", f?.net_income],
          ["Payroll FTEs", f?.fte],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-2xl border border-border px-4 py-3">
            <p className="text-xs text-muted">{label}</p>
            {profile.isPending ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <AnimatedNumber
                value={(v as number | null) ?? null}
                format={(x) => (label === "Payroll FTEs" ? Math.round(x).toLocaleString() : usd(x))}
                className="mt-1 block text-xl font-semibold tracking-tight"
              />
            )}
          </div>
        ))}
      </section>

      <section aria-labelledby="insights-h">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--accent)]" />
          <h2 id="insights-h" className="text-sm font-semibold">What stands out</h2>
          <span className="hidden text-xs text-muted sm:inline">Computed from the benchmark. Click any card to ask the copilot why.</span>
        </div>
        {insights.isPending ? (
          <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
        ) : (
          <m.div variants={stagger} initial="hidden" animate="show" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" key={insights.data?.insights.map((i) => i.title).join()}>
            {insights.data?.insights.slice(0, 6).map((i) => <InsightCard key={i.title} insight={i} />)}
            {insights.data?.insights.length === 0 && <p className="text-sm text-muted">Every directional KPI is within the peer interquartile range.</p>}
          </m.div>
        )}
      </section>

      <section aria-labelledby="kpis-h">
        <Card className="pb-5">
          <CardHeader
            title={<span id="kpis-h">Headline KPIs</span>}
            description="Value, gap to the peer median, and 4-year trend (dashed line: peer median)."
          />
          {bm.isPending ? (
            <div className="grid gap-3 px-5 pt-4 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">{HEADLINE.map((k) => <Skeleton key={k} className="h-32" />)}</div>
          ) : (
            <m.div variants={stagger} initial="hidden" animate="show" className="grid gap-3 px-5 pt-4 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
              {rows.map((r) => (
                <KpiCard
                  key={r.kpi}
                  row={r}
                  def={defByKey[r.kpi]}
                  spark={trend.data?.series.map((p) => p[r.kpi] as number | null)}
                  peerSpark={trend.data?.series.map((p) => p[`${r.kpi}_peer_median`] as number | null)}
                />
              ))}
            </m.div>
          )}
        </Card>
      </section>
    </div>
  );
}
