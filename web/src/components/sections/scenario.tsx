"use client";

import * as Slider from "@radix-ui/react-slider";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useDeferredValue, useState } from "react";

import { AnimatedNumber, Button, Card, ErrorState, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, usd } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const LEVERS = [
  { key: "volume_change_pct", label: "Patient volume", min: -20, max: 20, step: 0.5, unit: "%" },
  { key: "rate_change_pct", label: "Payment rates", min: -10, max: 10, step: 0.5, unit: "%" },
  { key: "opex_change_pct", label: "Operating expense", min: -10, max: 10, step: 0.5, unit: "%" },
  { key: "labor_cost_change_pct", label: "Labor cost", min: -10, max: 15, step: 0.5, unit: "%" },
] as const;

type Levers = Record<(typeof LEVERS)[number]["key"] | "variable_cost_share", number>;
const ZERO: Levers = { volume_change_pct: 0, rate_change_pct: 0, opex_change_pct: 0, labor_cost_change_pct: 0, variable_cost_share: 0.35 };

function Lever({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className={cn("tabular text-sm font-semibold", value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted")}>{format(value)}</span>
      </div>
      <Slider.Root value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} className="relative flex h-5 touch-none select-none items-center" aria-label={label}>
        <Slider.Track className="relative h-1.5 grow rounded-full bg-foreground/10">
          <Slider.Range className="absolute h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" />
        </Slider.Track>
        <Slider.Thumb className="block size-4 rounded-full bg-white shadow-md ring-2 ring-[var(--accent)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent)]/40" />
      </Slider.Root>
    </div>
  );
}

export function Scenario() {
  const { ccn, year, askCopilot } = useWorkspace();
  const [levers, setLevers] = useState<Levers>(ZERO);
  const deferred = useDeferredValue(levers); // keep sliders at 60fps; recompute when idle
  const q = useQuery({
    queryKey: ["scenario", ccn, year, deferred],
    queryFn: () => api.scenario(ccn, { year, ...deferred }),
    placeholderData: keepPreviousData,
  });
  if (q.isError) return <ErrorState title="Could not run the scenario" detail={String(q.error)} />;
  const s = q.data;
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v}%`;
  const bars = s
    ? [
        { label: "Revenue", base: s.baseline.net_patient_revenue, next: s.scenario.net_patient_revenue },
        { label: "Expense", base: s.baseline.operating_expense, next: s.scenario.operating_expense },
      ]
    : [];
  const maxBar = Math.max(1, ...bars.flatMap((b) => [b.base, b.next]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">What-if scenario</h2>
          <p className="text-sm text-muted">Move a lever; the operating margin updates instantly from the cost report baseline.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setLevers(ZERO)}><RotateCcw />Reset</Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const parts = LEVERS.filter((l) => levers[l.key]).map((l) => `${l.label.toLowerCase()} ${pct(levers[l.key])}`);
              askCopilot(parts.length ? `What if ${parts.join(" and ")}? What happens to our operating margin?` : "What if volume grows 5%?");
            }}
          >
            Explain with copilot
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,1fr)_1.4fr]">
        <Card className="space-y-6 p-5">
          {LEVERS.map((l) => (
            <Lever key={l.key} label={l.label} value={levers[l.key]} min={l.min} max={l.max} step={l.step} format={pct} onChange={(v) => setLevers((x) => ({ ...x, [l.key]: v }))} />
          ))}
          <div className="border-t border-border pt-5">
            <Lever label="Variable cost share" value={levers.variable_cost_share} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setLevers((x) => ({ ...x, variable_cost_share: v }))} />
            <p className="mt-2 text-xs text-muted">Share of operating expense that moves with volume. 35% is a planning default.</p>
          </div>
        </Card>

        <Card className="p-5">
          {!s ? (
            <Skeleton className="h-72" />
          ) : (
            <div className={cn("space-y-6 transition-opacity", q.isFetching && "opacity-80")}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted">Operating margin</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <AnimatedNumber value={s.scenario.operating_margin} format={(v) => `${(v * 100).toFixed(1)}%`} className="text-4xl font-semibold tracking-tight" />
                    <span className={cn("tabular text-sm font-medium", s.delta.operating_margin_pp >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                      {s.delta.operating_margin_pp >= 0 ? "+" : ""}{s.delta.operating_margin_pp.toFixed(1)} pts
                    </span>
                  </div>
                  <p className="tabular text-xs text-muted">Baseline {s.baseline.operating_margin_fmt}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Operating income change</p>
                  <AnimatedNumber value={s.delta.operating_income} format={(v) => `${v >= 0 ? "+" : ""}${usd(v)}`} className={cn("mt-1 block text-4xl font-semibold tracking-tight", s.delta.operating_income >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} />
                  <p className="tabular text-xs text-muted">Scenario income {usd(s.scenario.operating_income)}</p>
                </div>
              </div>
              <div className="space-y-4">
                {bars.map((b) => (
                  <div key={b.label}>
                    <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{b.label}</span><span className="tabular text-muted">{usd(b.base)} → <span className="text-foreground">{usd(b.next)}</span></span></div>
                    <div className="relative h-3 rounded-full bg-foreground/[0.06]">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/15" style={{ width: `${(b.base / maxBar) * 100}%` }} />
                      <motion.div className={cn("absolute inset-y-0 left-0 rounded-full", b.label === "Revenue" ? "bg-[var(--accent)]" : "bg-rose-500/80")} animate={{ width: `${(b.next / maxBar) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} style={{ mixBlendMode: "normal", opacity: 0.85 }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-muted">{s.formula}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
