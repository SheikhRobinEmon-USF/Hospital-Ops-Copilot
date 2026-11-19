"use client";

import { AnimatePresence, m } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { HospitalHeader, Overview } from "@/components/sections/overview";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { Info, Loader2, X } from "lucide-react";

import { API_URL, ApiError, ENGINE } from "@/lib/api";
import { RUN_LOCALLY_URL, useCopilotMode } from "@/lib/mode";
import { useBenchmark, useHealth, useInsights, useProfile } from "@/lib/queries";
import { useWorkspace, WorkspaceProvider } from "@/lib/workspace";

import { AuroraBackground, Sidebar, Topbar } from "./shell";

// Each section is its own chunk: the first paint ships only the shell and the Overview.
const loading = () => <Skeleton className="h-[520px]" />;
const Benchmark = dynamic(() => import("@/components/sections/benchmark").then((m) => m.Benchmark), { loading });
const Opportunities = dynamic(() => import("@/components/sections/opportunities").then((m) => m.Opportunities), { loading });
const Trends = dynamic(() => import("@/components/sections/trends").then((m) => m.Trends), { loading });
const Scenario = dynamic(() => import("@/components/sections/scenario").then((m) => m.Scenario), { loading });
const Market = dynamic(() => import("@/components/sections/market").then((m) => m.Market), { loading });
// Same footprint as the docked panel: shown before the panel mounts and while its chunk downloads.
function CopilotPlaceholder() {
  return <div aria-hidden className="glass hidden h-dvh w-[440px] shrink-0 border-y-0 border-r-0 xl:sticky xl:top-0 xl:block" />;
}
const CopilotPanel = dynamic(() => import("@/components/copilot/copilot-panel").then((m) => m.CopilotPanel), {
  ssr: false,
  loading: () => <CopilotPlaceholder />,
});
const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), { ssr: false });

/**
 * Mount heavy, initially hidden UI only when first needed. The copilot (markdown renderer, streaming)
 * and the command palette are deferred until opened, or until the browser is idle when the copilot
 * starts open on wide screens, so they never compete with the first paint.
 */
function DeferredChrome() {
  const { copilotOpen, paletteOpen } = useWorkspace();
  const [idle, setIdle] = useState(false);
  const [paletteUsed, setPaletteUsed] = useState(false);
  useEffect(() => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = ric ? ric(() => setIdle(true), { timeout: 2500 }) : window.setTimeout(() => setIdle(true), 1200);
    return () => {
      if (!ric) window.clearTimeout(id);
    };
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (paletteOpen) setPaletteUsed(true);
  }, [paletteOpen]);
  return (
    <>
      {copilotOpen && (idle || paletteUsed) ? (
        <CopilotPanel />
      ) : (
        // Reserve the docked panel's width on wide screens so mounting it causes no layout shift.
        copilotOpen && <CopilotPlaceholder />
      )}
      {paletteUsed && <CommandPalette />}
    </>
  );
}

function SectionView() {
  const { section } = useWorkspace();
  const view = { overview: <Overview />, benchmark: <Benchmark />, opportunities: <Opportunities />, trends: <Trends />, scenario: <Scenario />, market: <Market /> }[section];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: "easeOut" }}>
        {view}
      </m.div>
    </AnimatePresence>
  );
}

function FirstViewSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading hospital">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-6 w-[36rem] max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px]" />)}</div>
      <Skeleton className="h-[196px]" />
      <Skeleton className="h-[360px]" />
    </div>
  );
}

/**
 * Show one skeleton until the first view's data (fetched in parallel, started before hydration) is all
 * here, then insert the real page in one step. Inserting new content is not a layout shift; growing a
 * header whose pills wrap differently at every width would be. Later changes keep previous data on screen.
 */
function FirstView({ children }: { children: React.ReactNode }) {
  const { section, year, set } = useWorkspace();
  const profile = useProfile();
  const bm = useBenchmark();
  const insights = useInsights();
  const health = useHealth();
  const [missingYear, setMissingYear] = useState<number | null>(null);
  const yearNotFound = profile.isError && year !== undefined && profile.error instanceof ApiError && profile.error.status === 404;
  useEffect(() => {
    // A shared link can name a year this hospital did not report: fall back to its latest report.
    if (yearNotFound) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMissingYear(year ?? null);
      set({ year: undefined });
    }
  }, [yearNotFound, year, set]);
  const waiting = !health.data || !profile.data || (section === "overview" && (!bm.data || !insights.data) && !bm.isError && !insights.isError);
  if (profile.isError && !yearNotFound) return <ErrorState title="Could not load this hospital" detail={String(profile.error)} />;
  if (waiting || yearNotFound) return <FirstViewSkeleton />;
  return (
    <>
      {missingYear !== null && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-500/[0.07] px-4 py-2 text-sm ring-1 ring-inset ring-amber-500/25">
          <Info className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          This hospital has no {missingYear} cost report, so the latest one is shown.
          <button onClick={() => setMissingYear(null)} aria-label="Dismiss" className="ml-auto rounded p-0.5 text-muted hover:text-foreground">
            <X className="size-4" />
          </button>
        </p>
      )}
      {children}
    </>
  );
}

const HOSTED = !/localhost|127\.0\.0\.1/.test(API_URL);

function ApiGate({ children }: { children: React.ReactNode }) {
  const health = useHealth();
  if (health.isError && ENGINE === "browser") {
    return <ErrorState title="Could not load the demo data" detail="Check your connection and reload the page." />;
  }
  if (health.isError) {
    return (
      <ErrorState
        title="Cannot reach the Hospital Ops Copilot API"
        detail={
          HOSTED
            ? "The demo server did not respond. It may be restarting; please try again in a minute."
            : `Start it with \`hoc api\` (expected at ${API_URL}), then reload this page.`
        }
      />
    );
  }
  if (health.isPending && health.failureCount > 0) {
    return (
      <div className="grid place-items-center rounded-2xl border border-dashed border-border px-6 py-16 text-center" role="status">
        <Loader2 className="size-6 animate-spin text-[var(--accent)]" />
        <p className="mt-4 text-sm font-medium">{HOSTED ? "Waking up the demo server..." : "Connecting to the API..."}</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
          {HOSTED
            ? "The free hosting pauses the server when nobody has used it for a while. It usually starts in under a minute; this page continues on its own."
            : `Waiting for the API at ${API_URL}. Start it with \`hoc api\` or \`./scripts/dev.sh\`.`}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Tells public-demo visitors up front that the copilot is rule-based, not an AI model. */
function DemoBanner() {
  const { mode } = useCopilotMode();
  const [hidden, setHidden] = useState(false);
  if (mode !== "demo" || hidden) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl bg-amber-500/[0.07] px-4 py-3 text-sm ring-1 ring-inset ring-amber-500/25" role="note">
      <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="flex-1 leading-relaxed">
        <span className="font-semibold">Public demo.</span> All figures come from real CMS cost reports. The copilot here is the{" "}
        <span className="font-semibold">offline analyst</span>, a rule-based engine with no AI model, so answers are instant and templated.{" "}
        <a href={RUN_LOCALLY_URL} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent)] hover:underline">
          Run it locally
        </a>{" "}
        for AI-written answers from a local model (qwen3.5:4b via Ollama).
      </p>
      <button onClick={() => setHidden(true)} aria-label="Dismiss" className="rounded p-0.5 text-muted hover:text-foreground">
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Dashboard() {
  return (
    <WorkspaceProvider>
      <AuroraBackground />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-[var(--surface-strong)] focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 space-y-8 px-4 py-6 lg:px-8 lg:py-8">
            <ApiGate>
              <DemoBanner />
              <FirstView>
                <HospitalHeader />
                <SectionView />
              </FirstView>
            </ApiGate>
          </main>
        </div>
        <DeferredChrome />
      </div>
    </WorkspaceProvider>
  );
}
