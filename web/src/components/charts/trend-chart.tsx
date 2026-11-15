"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { formatKpi } from "@/lib/utils";

export interface TrendDatum {
  year: string;
  hospital: number | null;
  peer: number | null;
}

/** Hospital vs peer median over time. Loaded lazily: Recharts is the largest client dependency. */
export default function TrendChart({ data, unit }: { data: TrendDatum[]; unit: string; label?: string }) {
  const fmt = (v: number) => formatKpi(unit, v).replace(" days", "d");
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey="year" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
        <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} width={72} tick={{ fill: "var(--muted)", fontSize: 12 }} domain={["auto", "auto"]} />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          contentStyle={{ background: "var(--surface-strong)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
          formatter={(v, name) => [formatKpi(unit, Number(v)), name === "hospital" ? "This hospital" : "Peer median"]}
          labelFormatter={(l) => `Cost report ${l}`}
        />
        <Area type="monotone" dataKey="hospital" stroke="none" fill="url(#trendFill)" isAnimationActive animationDuration={700} />
        <Line type="monotone" dataKey="peer" name="peer" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 5" dot={false} animationDuration={700} />
        <Line type="monotone" dataKey="hospital" name="hospital" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--accent)", strokeWidth: 0 }} activeDot={{ r: 6 }} animationDuration={700} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

