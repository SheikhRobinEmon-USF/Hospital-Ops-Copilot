import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { PercentileStrip } from "@/components/charts/percentile-strip";
import { Sparkline } from "@/components/charts/sparkline";
import { AgentTimeline } from "@/components/copilot/copilot-panel";
import { KpiCard } from "@/components/sections/overview";
import { AnimatedNumber, Button, Card, CardHeader, Segmented, StatusBadge } from "@/components/ui/primitives";
import type { Status } from "@/lib/api";
import { usd } from "@/lib/utils";

import { arDef, arRow, marginDef, marginRow, occupancyRow } from "./fixtures";

const meta: Meta = { title: "Design system" };
export default meta;
type Story = StoryObj;

export const StatusBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(["better than peers", "worse than peers", "in line with peers", "above peer range", "below peer range", "insufficient data"] as Status[]).map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Button variant="primary">Ask copilot</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="primary" disabled>Disabled</Button>
    </div>
  ),
};

export const SegmentedControl: Story = {
  render: function Render() {
    const [v, setV] = useState(2024);
    return <Segmented layoutId="story-seg" value={v} onChange={setV} options={[2021, 2022, 2023, 2024].map((y) => ({ value: y, label: `FY${String(y).slice(2)}` }))} />;
  },
};

export const KpiCards: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
      <KpiCard row={marginRow} def={marginDef} spark={[-0.055, -0.092, -0.1, -0.158]} peerSpark={[-0.02, -0.03, -0.021, -0.005]} />
      <KpiCard row={occupancyRow} def={{ ...marginDef, key: "occupancy_rate", label: "Occupancy rate" }} spark={[0.897, 0.984, 0.848, 0.879]} peerSpark={[0.74, 0.77, 0.764, 0.79]} />
      <KpiCard row={arRow} def={arDef} spark={[55, 58, 63, 66.5]} peerSpark={[52, 53, 52.6, 51.5]} />
    </div>
  ),
};

export const PercentileStrips: Story = {
  render: () => (
    <Card className="max-w-xl space-y-4 p-5">
      {[marginRow, occupancyRow, arRow].map((r) => (
        <div key={r.kpi}>
          <p className="mb-1 text-xs text-muted">{r.label} · P{Math.round(r.percentile ?? 0)}</p>
          <PercentileStrip row={r} />
        </div>
      ))}
    </Card>
  ),
};

export const Sparklines: Story = {
  render: () => (
    <div className="flex gap-6">
      <Sparkline values={[21134, 23010, 24121, 28080]} peer={[20500, 22000, 23247, 24656]} />
      <Sparkline values={[0.9, 0.98, 0.85, 0.88]} />
    </div>
  ),
};

export const AnimatedFigures: Story = {
  render: function Render() {
    const [v, setV] = useState(161_900_000);
    return (
      <Card className="w-fit p-5">
        <CardHeader title="Recurring cost savings" description="Click to animate" />
        <div className="px-5 pb-2 pt-3">
          <AnimatedNumber value={v} format={(x) => usd(x)} className="text-gradient text-4xl font-semibold" />
        </div>
        <div className="px-5 pb-4"><Button size="sm" onClick={() => setV(Math.round(Math.random() * 3e8))}>Randomize</Button></div>
      </Card>
    );
  },
};

export const CopilotAgentTimeline: Story = {
  render: () => (
    <div className="max-w-md space-y-4">
      <AgentTimeline
        done={false}
        steps={[
          { name: "search_hospitals", args: { query: "Tampa General" }, status: "done", summary: "1 match(es): Tampa General Hospital" },
          { name: "benchmark_hospital", args: { ccn: "100128", year: 2023 }, status: "running" },
        ]}
      />
      <AgentTimeline
        done
        steps={[
          { name: "find_opportunities", args: { ccn: "100128" }, status: "done", summary: "5 opportunities, $161.9M recurring" },
        ]}
      />
    </div>
  ),
};
