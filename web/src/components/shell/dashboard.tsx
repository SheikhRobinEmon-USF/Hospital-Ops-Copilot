"use client";

import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";

import { HospitalHeader, Overview } from "@/components/sections/overview";
import { ErrorState, Skeleton } from "@/components/ui/primitives";
import { API_URL } from "@/lib/api";
import { useHealth } from "@/lib/queries";
import { useWorkspace, WorkspaceProvider } from "@/lib/workspace";

import { CommandPalette } from "./command-palette";
import { AuroraBackground, Sidebar, Topbar } from "./shell";

// Each section is its own chunk: the first paint ships only the shell and the Overview.
const loading = () => <Skeleton className="h-[520px]" />;
const Benchmark = dynamic(() => import("@/components/sections/benchmark").then((m) => m.Benchmark), { loading });
const Opportunities = dynamic(() => import("@/components/sections/opportunities").then((m) => m.Opportunities), { loading });
const Trends = dynamic(() => import("@/components/sections/trends").then((m) => m.Trends), { loading });
const Scenario = dynamic(() => import("@/components/sections/scenario").then((m) => m.Scenario), { loading });
const Market = dynamic(() => import("@/components/sections/market").then((m) => m.Market), { loading });
const CopilotPanel = dynamic(() => import("@/components/copilot/copilot-panel").then((m) => m.CopilotPanel), { ssr: false });

function SectionView() {
  const { section } = useWorkspace();
  const view = { overview: <Overview />, benchmark: <Benchmark />, opportunities: <Opportunities />, trends: <Trends />, scenario: <Scenario />, market: <Market /> }[section];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: "easeOut" }}>
        {view}
      </motion.div>
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
        <CopilotPanel />
      </div>
      <CommandPalette />
    </WorkspaceProvider>
  );
}
