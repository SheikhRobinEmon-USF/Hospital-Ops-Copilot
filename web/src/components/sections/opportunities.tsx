"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import { AnimatedNumber, Button, Card, ErrorState, Segmented, Skeleton } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import type { Opportunity } from "@/lib/api";
import { useOpportunities } from "@/lib/queries";
import { cn, usd } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

const TYPE_STYLE: Record<Opportunity["impact_type"], { bar: string; label: string }> = {
  "cost savings": { bar: "from-[var(--accent)] to-[var(--accent-2)]", label: "Recurring savings" },
  "one-time cash release": { bar: "from-sky-500 to-cyan-400", label: "One-time cash" },
  "revenue upside": { bar: "from-amber-500 to-orange-400", label: "Revenue upside" },
  capacity: { bar: "from-emerald-500 to-teal-400", label: "Capacity" },
};

export function Opportunities() {
  const [target, setTarget] = useState<"median" | "top_quartile">("median");
  const q = useOpportunities(target);
  const { askCopilot } = useWorkspace();
  if (q.isError) return <ErrorState title="Could not size opportunities" detail={String(q.error)} />;
  const d = q.data;
  const sized = d?.opportunities.filter((o) => o.annual_impact_usd) ?? [];
  const max = Math.max(1, ...sized.map((o) => o.annual_impact_usd ?? 0));
  const cash = sized.filter((o) => o.impact_type === "one-time cash release").reduce((a, o) => a + (o.annual_impact_usd ?? 0), 0);
  const upside = sized.filter((o) => o.impact_type === "revenue upside").reduce((a, o) => a + (o.annual_impact_usd ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Opportunity sizing</h2>
          <p className="text-sm text-muted">Dollar value of closing each gap to the {target === "median" ? "peer median" : "peer top quartile"}{d ? ` (${d.peer_group.n_hospitals} peers)` : ""}.</p>
        </div>
        <Segmented layoutId="opp-target" size="sm" value={target} onChange={setTarget} options={[{ value: "median", label: "Peer median" }, { value: "top_quartile", label: "Top quartile" }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Recurring cost savings", value: d?.total_recurring_cost_savings_usd ?? null, hint: d?.total_note, accent: true },
          { label: "One-time cash release", value: d ? cash : null, hint: "From reducing days in accounts receivable to target. Not recurring profit." },
          { label: "Revenue upside (upper bound)", value: d ? upside : null, hint: "Driven mostly by payer mix and contracts." },
        ].map((s) => (
          <Card key={s.label} className={cn("p-5", s.accent && "ring-1 ring-[var(--accent)]/30")}>
            <Tooltip content={s.hint ?? ""}>
              <p className="w-fit cursor-help text-xs text-muted underline decoration-dotted underline-offset-4">{s.label}</p>
            </Tooltip>
            {q.isPending ? <Skeleton className="mt-2 h-9 w-32" /> : (
              <AnimatedNumber value={s.value} format={(v) => usd(v)} className={cn("mt-1 block text-3xl font-semibold tracking-tight", s.accent && "text-gradient")} />
            )}
          </Card>
        ))}
      </div>

      <Card className="p-5">
        {q.isPending ? (
          <Skeleton className="h-64" />
        ) : !d || d.opportunities.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">At or better than target on every sized KPI.</p>
        ) : (
          <ul className="space-y-2">
            {d.opportunities.map((o, i) => (
              <OpportunityRow key={o.area} o={o} max={max} index={i} onAsk={() => askCopilot(`Explain the ${o.area.toLowerCase()} opportunity and what would close it.`)} />
            ))}
          </ul>
        )}
      </Card>
      {d && <p className="text-xs text-muted">{d.caveat}</p>}
    </div>
  );
}

function OpportunityRow({ o, max, index, onAsk }: { o: Opportunity; max: number; index: number; onAsk: () => void }) {
  const [open, setOpen] = useState(false);
  const style = TYPE_STYLE[o.impact_type];
  const width = o.annual_impact_usd ? Math.max(4, (o.annual_impact_usd / max) * 100) : 0;
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} asChild>
      <li className="rounded-xl transition hover:bg-foreground/[0.03]">
        <Collapsible.Trigger className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-xl px-3 py-3 text-left md:grid-cols-[180px_1fr_120px_20px]">
          <div>
            <p className="text-sm font-medium">{o.area}</p>
            <p className="tabular text-xs text-muted">{o.current} → {o.target}</p>
          </div>
          <div className="order-3 col-span-2 h-2.5 overflow-hidden rounded-full bg-foreground/[0.06] md:order-none md:col-span-1">
            {o.annual_impact_usd ? (
              <motion.div className={cn("h-full rounded-full bg-gradient-to-r", style.bar)} initial={{ width: 0 }} animate={{ width: `${width}%` }} transition={{ delay: 0.05 * index, duration: 0.6, ease: "easeOut" }} />
            ) : (
              <div className="h-full w-full bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,var(--border)_4px,var(--border)_8px)]" />
            )}
          </div>
          <div className="text-right">
            <p className="tabular text-sm font-semibold">{o.annual_impact_usd ? o.annual_impact_fmt : "Capacity"}</p>
            <p className="text-[11px] text-muted">{style.label}</p>
          </div>
          <ChevronDown className={cn("hidden size-4 text-muted transition md:block", open && "rotate-180")} />
        </Collapsible.Trigger>
        <Collapsible.Content className="overflow-hidden px-3 pb-3 data-[state=closed]:hidden">
          <div className="grid gap-3 rounded-lg bg-foreground/[0.03] p-3 text-xs leading-relaxed md:grid-cols-2">
            <div><p className="font-medium">Formula</p><p className="mt-0.5 font-mono text-[11px] text-muted">{o.formula}</p></div>
            <div><p className="font-medium">Assumptions</p><p className="mt-0.5 text-muted">{o.assumptions}</p></div>
            <div className="md:col-span-2">
              <Button size="sm" variant="outline" onClick={onAsk}><Sparkles className="text-[var(--accent)]" />Ask copilot about this</Button>
            </div>
          </div>
        </Collapsible.Content>
      </li>
    </Collapsible.Root>
  );
}
