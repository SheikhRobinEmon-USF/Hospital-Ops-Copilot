"use client";

import * as Popover from "@radix-ui/react-popover";
import {
  Activity,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Gauge,
  LineChart,
  Moon,
  PanelRightOpen,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trophy,
  Users,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";

import { Button, Kbd, Segmented } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import type { PeerDim } from "@/lib/api";
import { MODE_COPY, useCopilotMode } from "@/lib/mode";
import { useHealth, useProfile } from "@/lib/queries";
import { cn, PEER_DIM_LABEL, titleCase } from "@/lib/utils";
import { type Section, useWorkspace } from "@/lib/workspace";

export const NAV: { id: Section; label: string; icon: ReactNode; hint: string }[] = [
  { id: "overview", label: "Overview", icon: <Gauge />, hint: "Headline KPIs and AI insights" },
  { id: "benchmark", label: "Benchmark", icon: <Users />, hint: "Every KPI against your peer group" },
  { id: "opportunities", label: "Opportunities", icon: <CircleDollarSign />, hint: "Dollar value of closing gaps" },
  { id: "trends", label: "Trends", icon: <LineChart />, hint: "Multi-year trajectory vs peers" },
  { id: "scenario", label: "What-if", icon: <SlidersHorizontal />, hint: "Model volume, rate, and cost changes" },
  { id: "market", label: "Market", icon: <Trophy />, hint: "Rank hospitals on any KPI" },
];

export function AuroraBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-1/4 -top-1/3 h-[70vh] w-[70vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent)_28%,transparent),transparent)] blur-3xl dark:opacity-70" />
      <div className="absolute -bottom-1/3 -right-1/4 h-[70vh] w-[60vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--accent-2)_22%,transparent),transparent)] blur-3xl [animation-delay:-6s] dark:opacity-60" />
      <div className="absolute inset-0 bg-[linear-gradient(var(--grid)_1px,transparent_1px),linear-gradient(90deg,var(--grid)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
    </div>
  );
}

export function Sidebar() {
  const { section, set } = useWorkspace();
  const health = useHealth();
  const { mode, model } = useCopilotMode();
  return (
    <aside className="glass sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-y-0 border-l-0 px-3 py-5 lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-lg shadow-[var(--accent)]/30">
          <Activity className="size-5" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Hospital Ops</p>
          <p className="text-xs text-muted">Copilot</p>
        </div>
      </div>
      <nav className="mt-8 flex flex-col gap-0.5" aria-label="Sections">
        {NAV.map((n) => {
          const active = n.id === section;
          return (
            <button
              key={n.id}
              onClick={() => set({ section: n.id })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors [&_svg]:size-4",
                active ? "text-foreground" : "text-muted hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {active && (
                <m.span
                  layoutId="nav-active"
                  className="absolute inset-0 -z-10 rounded-lg bg-foreground/[0.07] ring-1 ring-inset ring-border"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
              <span className={cn(active && "text-[var(--accent)]")}>{n.icon}</span>
              {n.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 px-2 text-xs text-muted">
        <Tooltip content={MODE_COPY[mode].long} side="right" className="max-w-sm">
          <div tabIndex={0} className="flex cursor-help items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", mode === "ai" ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/60" : health.isError ? "bg-rose-500" : "bg-amber-500")} />
            {health.isError ? "API offline" : mode === "ai" ? `AI model: ${model}` : mode === "demo" ? "Public demo · offline analyst (no AI)" : mode === "offline" ? "Offline analyst (no AI)" : "Connecting..."}
          </div>
        </Tooltip>
        <p className="leading-relaxed">
          Data: <a className="underline decoration-dotted underline-offset-2 hover:text-foreground" href="https://data.cms.gov/provider-compliance/cost-report/hospital-provider-cost-report" target="_blank" rel="noreferrer">CMS Hospital Provider Cost Report</a>
          {health.data && `, ${health.data.years[0]} to ${health.data.years.at(-1)}, ${health.data.hospitals.toLocaleString()} hospitals.`}
        </p>
      </div>
    </aside>
  );
}

function PeerPicker() {
  const { peerDims, set } = useWorkspace();
  const all: PeerDim[] = ["facility_type", "bed_band", "state", "ownership", "urban_rural"];
  const toggle = (d: PeerDim) => {
    const next = peerDims.includes(d) ? peerDims.filter((x) => x !== d) : [...peerDims, d];
    set({ peerDims: next.length ? next : ["facility_type"] });
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="md" aria-label="Peer group">
          <Users />
          <span className="hidden 2xl:inline">Peers:</span>
          <span className="hidden max-w-40 truncate text-muted 2xl:inline">{peerDims.map((d) => PEER_DIM_LABEL[d]).join(" + ")}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-72 rounded-xl bg-[var(--surface-strong)] p-3 shadow-2xl ring-1 ring-border">
          <p className="px-1 text-xs font-medium">Compare against hospitals with the same</p>
          <div className="mt-2 flex flex-col gap-0.5">
            {all.map((d) => {
              const on = peerDims.includes(d);
              return (
                <button key={d} onClick={() => toggle(d)} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-foreground/5">
                  {PEER_DIM_LABEL[d]}
                  <span className={cn("grid size-4 place-items-center rounded border", on ? "border-transparent bg-[var(--accent)] text-white" : "border-border")}>
                    {on && <Check className="size-3" />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted">
            Groups under 10 hospitals are widened automatically. Partial-year reports are excluded from peers.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  return (
    <Tooltip content={dark ? "Light mode" : "Dark mode"}>
      <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "dark")}>
        <AnimatePresence mode="wait" initial={false}>
          <m.span key={dark ? "moon" : "sun"} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
            {dark ? <Moon /> : <Sun />}
          </m.span>
        </AnimatePresence>
      </Button>
    </Tooltip>
  );
}

export function Topbar() {
  const { year, set, copilotOpen, setCopilotOpen, setPaletteOpen, section } = useWorkspace();
  const profile = useProfile();
  const years = profile.data?.available_years ?? [];
  const latest = years.at(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setCopilotOpen(!copilotOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copilotOpen, setCopilotOpen, setPaletteOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-[var(--background)]/70 backdrop-blur-xl">
      <div className="flex h-14 min-w-0 items-center gap-2 px-4 lg:px-6">
        <button
          onClick={() => setPaletteOpen(true)}
          className="glass group flex h-9 min-w-[200px] flex-1 items-center gap-2.5 rounded-lg px-3 text-left text-sm transition hover:bg-[var(--surface-strong)] md:max-w-md"
        >
          <Building2 className="size-4 shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 truncate font-medium">{profile.data ? titleCase(profile.data.name) : "Loading..."}</span>
          <span className="ml-auto hidden shrink-0 items-center gap-1 text-muted 2xl:flex">
            <Search className="size-3.5" />
            <Kbd>⌘K</Kbd>
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {years.length > 0 && section !== "trends" && (
            <div className="hidden md:block">
              <Segmented
                layoutId="year"
                size="sm"
                value={year ?? latest ?? 0}
                onChange={(v) => set({ year: v === latest ? undefined : v })}
                options={years.map((y) => ({ value: y, label: `FY${String(y).slice(2)}` }))}
              />
            </div>
          )}
          <PeerPicker />
          <ThemeToggle />
          <Button variant={copilotOpen ? "secondary" : "primary"} onClick={() => setCopilotOpen(!copilotOpen)} aria-pressed={copilotOpen}>
            {copilotOpen ? <PanelRightOpen /> : <Sparkles />}
            <span className={cn("sr-only", copilotOpen ? "2xl:not-sr-only" : "sm:not-sr-only")}>Copilot</span>
            <span className="hidden 2xl:inline"><Kbd>⌘J</Kbd></span>
          </Button>
        </div>
      </div>
      <MobileNav />
    </header>
  );
}

function MobileNav() {
  const { section, set } = useWorkspace();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden" aria-label="Sections">
      {NAV.map((n) => (
        <button
          key={n.id}
          onClick={() => set({ section: n.id })}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs [&_svg]:size-3.5",
            n.id === section ? "bg-foreground/10 text-foreground" : "text-muted",
          )}
        >
          {n.icon}
          {n.label}
        </button>
      ))}
    </nav>
  );
}
