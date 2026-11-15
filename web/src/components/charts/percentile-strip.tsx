"use client";

import { motion } from "motion/react";

import type { KpiRow } from "@/lib/api";
import { cn, STATUS_STYLE } from "@/lib/utils";

/**
 * One KPI on a 0-100 percentile scale: shaded interquartile band, median tick, and the hospital's
 * position. Direction-aware: the favorable end is labeled so "high" never reads as "good" by accident.
 */
export function PercentileStrip({ row, compact = false }: { row: KpiRow; compact?: boolean }) {
  const pct = row.percentile;
  const s = STATUS_STYLE[row.status];
  const favorable = row.direction === "higher" ? "right" : row.direction === "lower" ? "left" : null;
  return (
    <div className={cn("relative w-full", compact ? "h-5" : "h-7")} role="img" aria-label={`${row.label}: ${pct ?? "no"} percentile among peers`}>
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/[0.06]">
        {favorable && (
          <div
            className={cn(
              "absolute inset-y-0 w-1/3 rounded-full opacity-60",
              favorable === "right" ? "right-0 bg-gradient-to-r from-transparent to-emerald-500/25" : "left-0 bg-gradient-to-l from-transparent to-emerald-500/25",
            )}
          />
        )}
        <div className="absolute inset-y-0 left-1/4 right-1/4 rounded-full bg-foreground/[0.08] ring-1 ring-inset ring-border" />
        <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/40" />
      </div>
      {pct !== null && (
        <motion.div
          className="absolute top-1/2"
          initial={{ left: "50%", opacity: 0 }}
          animate={{ left: `${pct}%`, opacity: 1 }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        >
          <span className={cn("block -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface-strong)]", s.dot, compact ? "size-2.5" : "size-3.5")} />
        </motion.div>
      )}
    </div>
  );
}
