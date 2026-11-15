"use client";

import { motion } from "motion/react";
import { useId } from "react";

/** Dependency-free SVG sparkline: hospital line plus dashed peer-median line. */
export function Sparkline({
  values,
  peer,
  width = 120,
  height = 36,
  className,
}: {
  values: (number | null)[];
  peer?: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const id = useId();
  const all = [...values, ...(peer ?? [])].filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.filter((v) => v !== null).length < 2 || all.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const path = (vs: (number | null)[]) =>
    vs
      .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
      .filter(Boolean)
      .map((p, i) => `${i ? "L" : "M"}${p}`)
      .join(" ");
  const main = path(values);
  const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const last = values[lastIdx] as number;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {peer && <path d={path(peer)} fill="none" stroke="var(--chart-2)" strokeWidth="1.25" strokeDasharray="3 3" opacity="0.7" />}
      <path d={`${main} L${x(lastIdx)},${height} L${x(0)},${height} Z`} fill={`url(#${id})`} />
      <motion.path d={main} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: "easeOut" }} />
      <circle cx={x(lastIdx)} cy={y(last)} r="2.5" fill="var(--accent)" />
    </svg>
  );
}
