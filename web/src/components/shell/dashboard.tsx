"use client";

import { AnimatePresence, m } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { HospitalHeader, Overview } from "@/components/sections/overview";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { API_URL } from "@/lib/api";
import { useHealth } from "@/lib/queries";
import { useWorkspace, WorkspaceProvider } from "@/lib/workspace";

import { AuroraBackground, Sidebar, Topbar } from "./shell";

// Each section is its own chunk: the first paint ships only the shell and the Overview.
const loading = () => <Skeleton className="h-[520px]" />;
const Benchmark = dynamic(() => import("@/components/sections/benchmark").then((m) => m.Benchmark), { loading });
const Opportunities = dynamic(() => import("@/components/sections/opportunities").then((m) => m.Opportunities), { loading });
const Trends = dynamic(() => import("@/components/sections/trends").then((m) => m.Trends), { loading });
const Scenario = dynamic(() => import("@/components/sections/scenario").then((m) => m.Scenario), { loading });
const Market = dynamic(() => import("@/components/sections/market").then((m) => m.Market), { loading });
const CopilotPanel = dynamic(() => import("@/components/copilot/copilot-panel").then((m) => m.CopilotPanel), { ssr: false });
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
        copilotOpen && <div aria-hidden className="glass hidden h-dvh w-[440px] shrink-0 border-y-0 border-r-0 xl:sticky xl:top-0 xl:block" />
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

function ApiGate({ children }: { children: React.ReactNode }) {
  const health = useHealth();
  if (health.isError) {
    return (
      <ErrorState
        title="Cannot reach the Hospital Ops Copilot API"
        detail={`Start it with \`hoc api\` (expected at ${API_URL}), then reload this page.`}
      />
    );
  }
  return <>{children}</>;
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
              <HospitalHeader />
              <SectionView />
            </ApiGate>
          </main>
        </div>
        <DeferredChrome />
      </div>
    </WorkspaceProvider>
  );
}
