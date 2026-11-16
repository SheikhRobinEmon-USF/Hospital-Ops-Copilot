"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { PeerDim } from "./api";

export type Section = "overview" | "benchmark" | "opportunities" | "trends" | "scenario" | "market";
export const SECTIONS: Section[] = ["overview", "benchmark", "opportunities", "trends", "scenario", "market"];

export interface WorkspaceState {
  ccn: string;
  year: number | undefined; // undefined = latest report
  peerDims: PeerDim[];
  section: Section;
}

interface Workspace extends WorkspaceState {
  set: (patch: Partial<WorkspaceState>) => void;
  copilotOpen: boolean;
  setCopilotOpen: (open: boolean) => void;
  /** Question queued from elsewhere in the UI (insight cards, KPI rows) for the copilot to ask. */
  pendingQuestion: string | null;
  askCopilot: (q: string) => void;
  consumeQuestion: () => string | null;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}

const DEFAULTS: WorkspaceState = {
  ccn: "100128",
  year: undefined,
  peerDims: ["facility_type", "bed_band"],
  section: "overview",
};

const Ctx = createContext<Workspace | null>(null);

function readUrl(): Partial<WorkspaceState> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Partial<WorkspaceState> = {};
  const ccn = p.get("ccn");
  if (ccn && /^\d{6}$/.test(ccn)) out.ccn = ccn;
  const year = Number(p.get("year"));
  if (year) out.year = year;
  const peers = p.get("peers");
  if (peers) out.peerDims = peers.split(",").filter(Boolean) as PeerDim[];
  const view = p.get("view") as Section | null;
  if (view && SECTIONS.includes(view)) out.section = view;
  return out;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(true);
  const [pendingQuestion, setPending] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    // Read deep-link state once on mount; window is unavailable during prerender.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, ...readUrl() }));
    setHydrated(true);
    if (window.matchMedia("(max-width: 1279px)").matches) setCopilotOpen(false);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const p = new URLSearchParams();
    p.set("ccn", state.ccn);
    if (state.year) p.set("year", String(state.year));
    if (state.peerDims.join(",") !== DEFAULTS.peerDims.join(",")) p.set("peers", state.peerDims.join(","));
    if (state.section !== "overview") p.set("view", state.section);
    window.history.replaceState(null, "", `?${p.toString()}`);
  }, [state, hydrated]);

  const set = useCallback((patch: Partial<WorkspaceState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      if (patch.ccn && patch.ccn !== s.ccn && !("year" in patch)) next.year = undefined;
      return next;
    });
  }, []);

  const askCopilot = useCallback((q: string) => {
    setPending(q);
    setCopilotOpen(true);
  }, []);

  const consumeQuestion = useCallback(() => {
    const q = pendingQuestion;
    setPending(null);
    return q;
  }, [pendingQuestion]);

  const value = useMemo<Workspace>(
    () => ({ ...state, set, copilotOpen, setCopilotOpen, pendingQuestion, askCopilot, consumeQuestion, paletteOpen, setPaletteOpen }),
    [state, set, copilotOpen, pendingQuestion, askCopilot, consumeQuestion, paletteOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
