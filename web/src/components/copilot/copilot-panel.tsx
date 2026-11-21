"use client";

import * as Collapsible from "@radix-ui/react-collapsible";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { type FinalEvent, streamAsk } from "@/lib/api";
import { MODE_COPY, RUN_LOCALLY_URL, useCopilotMode } from "@/lib/mode";
import { useModels, useProfile } from "@/lib/queries";
import { cn, TOOL_LABEL, titleCase } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

export interface Step {
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  summary?: string;
}

interface Turn {
  id: string;
  question: string;
  answer: string;
  steps: Step[];
  status: "streaming" | "done" | "error" | "stopped";
  backend?: "ollama" | "offline";
  model?: string | null;
  final?: FinalEvent;
  error?: string;
}

const STARTERS = [
  "How do we compare to our peers?",
  "What are our biggest savings opportunities?",
  "How has our operating margin changed over time?",
  "What would a 4% labor cost increase do to our margin?",
  "How is cost per adjusted discharge calculated?",
];

/* ------------------------------------------------------------------ voice input (Web Speech API) */

type SpeechRec = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; interimResults: boolean; lang: string };

function getSpeechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

function useVoice(onText: (t: string) => void) {
  const supported = useSyncExternalStore(noopSubscribe, () => getSpeechCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  const toggle = useCallback(() => {
    const Ctor = getSpeechCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => onText(Array.from(e.results).map((x) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }, [listening, onText]);
  return { supported, listening, toggle };
}

/* ------------------------------------------------------------------ panel */

export function CopilotPanel() {
  const { ccn, year, copilotOpen, setCopilotOpen, pendingQuestion, consumeQuestion } = useWorkspace();
  const profile = useProfile();
  const models = useModels();
  const { mode } = useCopilotMode();
  const [model, setModel] = useState<string | undefined>(undefined);
  const [threads, setThreads] = useState<Record<string, Turn[]>>({});
  const [input, setInput] = useState("");
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turns = useMemo(() => threads[ccn] ?? [], [threads, ccn]);
  const busy = turns.at(-1)?.status === "streaming";
  const voice = useVoice(setInput);
  const activeModel = model ?? models.data?.default;

  const update = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setThreads((all) => ({ ...all, [ccn]: (all[ccn] ?? []).map((t) => (t.id === id ? fn(t) : t)) }));
  }, [ccn]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setInput("");
      const id = crypto.randomUUID();
      const history = turns.filter((t) => t.status === "done").slice(-3).flatMap((t) => [
        { role: "user", content: t.question },
        { role: "assistant", content: t.answer },
      ]);
      setThreads((all) => ({ ...all, [ccn]: [...(all[ccn] ?? []), { id, question: q, answer: "", steps: [], status: "streaming" }] }));
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        for await (const ev of streamAsk({ question: q, ccn, year, model: models.data?.ollama_available ? activeModel : undefined, history }, ctrl.signal)) {
          switch (ev.type) {
            case "start":
              // A second "start" means the server fell back to the offline analyst: drop the abandoned steps.
              update(id, (t) => ({ ...t, backend: ev.backend, model: ev.model, steps: t.backend ? [] : t.steps }));
              break;
            case "tool_start":
              update(id, (t) => ({ ...t, steps: [...t.steps, { name: ev.name, args: ev.args, status: "running" }] }));
              break;
            case "tool_end":
              update(id, (t) => {
                const steps = [...t.steps];
                const i = steps.findLastIndex((s) => s.name === ev.name && s.status === "running");
                if (i >= 0) steps[i] = { ...steps[i], status: ev.ok ? "done" : "error", summary: ev.summary };
                return { ...t, steps };
              });
              break;
            case "token":
              update(id, (t) => ({ ...t, answer: t.answer + ev.text }));
              break;
            case "reset":
              update(id, (t) => ({ ...t, answer: "" }));
              break;
            case "final":
              update(id, (t) => ({ ...t, answer: ev.answer, final: ev, status: "done", backend: ev.backend, model: ev.model }));
              break;
            case "error":
              update(id, (t) => ({ ...t, status: "error", error: ev.message }));
              break;
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) update(id, (t) => ({ ...t, status: "stopped" }));
        else update(id, (t) => ({ ...t, status: "error", error: e instanceof Error ? e.message : String(e) }));
      } finally {
        abort.current = null;
      }
    },
    [busy, ccn, year, turns, update, activeModel, models.data?.ollama_available],
  );

  // Questions queued from insight cards, KPI rows, the command palette.
  useEffect(() => {
    if (pendingQuestion && !busy) {
      const q = consumeQuestion();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (q) void ask(q);
    }
  }, [pendingQuestion, busy, consumeQuestion, ask]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const name = profile.data ? titleCase(profile.data.name) : "this hospital";

  return (
    <AnimatePresence initial={false}>
      {copilotOpen && (
        <m.aside
          key="copilot"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: "spring", bounce: 0.1, duration: 0.4 }}
          className="glass fixed inset-0 z-40 flex flex-col border-y-0 border-r-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] xl:sticky xl:top-0 xl:z-auto xl:h-dvh xl:w-[440px] xl:shrink-0"
          aria-label="Copilot"
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white"><Sparkles className="size-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
                Copilot
                <Tooltip content={MODE_COPY[mode].long} className="max-w-sm">
                  <span
                    tabIndex={0}
                    className={cn(
                      "cursor-help rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                      mode === "ai" ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400",
                    )}
                  >
                    {mode === "ai" ? "AI model" : mode === "unknown" ? "..." : "No AI model"}
                  </span>
                </Tooltip>
              </p>
              <p className="truncate text-[11px] text-muted">
                {mode === "ai" ? `${activeModel ?? "Local model"} via Ollama · runs on this machine` : mode === "demo" ? "Rule-based offline analyst · instant, exact figures" : mode === "offline" ? "Rule-based offline analyst · open Ollama for AI answers" : "Connecting..."}
              </p>
            </div>
            {models.data?.ollama_available && models.data.models.length > 0 && (
              <select
                value={activeModel}
                onChange={(e) => setModel(e.target.value)}
                className="h-7 max-w-32 rounded-md bg-foreground/5 px-2 text-xs ring-1 ring-inset ring-border"
                aria-label="Model"
              >
                {models.data.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {turns.length > 0 && (
              <Tooltip content="New conversation">
                <Button variant="ghost" size="icon" className="size-7" aria-label="New conversation" disabled={busy} onClick={() => setThreads((a) => ({ ...a, [ccn]: [] }))}><RotateCcw /></Button>
              </Tooltip>
            )}
            <Button variant="ghost" size="icon" className="size-7" aria-label="Close copilot" onClick={() => setCopilotOpen(false)}><X /></Button>
          </header>

          <div ref={scroller} className="flex-1 space-y-6 overflow-y-auto px-4 py-5" aria-live="polite">
            {turns.length === 0 ? (
              <div className="flex h-full flex-col justify-end gap-4">
                <div>
                  <p className="text-lg font-semibold tracking-tight">Ask about <span className="text-gradient">{name}</span></p>
                  <p className="mt-1 text-sm text-muted">
                    Answers come from CMS cost report data through tools. Every figure is checked against the data, with sources.
                  </p>
                </div>
                {(mode === "demo" || mode === "offline") && (
                  <div className="rounded-xl bg-amber-500/[0.07] p-3 text-xs leading-relaxed ring-1 ring-inset ring-amber-500/25">
                    <p className="font-semibold text-amber-700 dark:text-amber-400">
                      {mode === "demo" ? "Public demo: no AI model" : "Ollama not detected: no AI model"}
                    </p>
                    <p className="mt-1 text-foreground/80">
                      {mode === "demo"
                        ? "Questions are answered by the offline analyst, a rule-based engine that picks the right analysis and fills in a template. Figures are exact; wording is fixed."
                        : "The offline analyst is answering. Open the Ollama app and reload for AI-written answers."}
                    </p>
                    {mode === "demo" && (
                      <a href={RUN_LOCALLY_URL} target="_blank" rel="noreferrer" className="mt-1.5 inline-block font-medium text-[var(--accent)] hover:underline">
                        Run it locally with the AI model (qwen3.5:4b) →
                      </a>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  {STARTERS.map((s, i) => (
                    <m.button
                      key={s}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * i }}
                      onClick={() => ask(s)}
                      className="rounded-xl px-3 py-2 text-left text-sm ring-1 ring-inset ring-border transition hover:bg-foreground/5 hover:ring-[var(--accent)]/40"
                    >
                      {s}
                    </m.button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t, i) => <TurnView key={t.id} turn={t} isLast={i === turns.length - 1} onFollowup={ask} />)
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="border-t border-border p-3"
          >
            <div className="flex items-end gap-2 rounded-2xl bg-[var(--surface-strong)] p-2 ring-1 ring-border transition focus-within:ring-[var(--accent)]/50">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                rows={1}
                placeholder={voice.listening ? "Listening..." : mode === "ai" ? `Ask the AI about ${name}...` : "Ask the offline analyst..."}
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted"
                aria-label="Question"
              />
              {voice.supported && (
                <Tooltip content={voice.listening ? "Stop dictation" : "Dictate a question"}>
                  <Button type="button" variant="ghost" size="icon" className={cn("size-9", voice.listening && "text-rose-500")} onClick={voice.toggle} aria-label="Voice input">
                    {voice.listening ? <MicOff /> : <Mic />}
                  </Button>
                </Tooltip>
              )}
              {busy ? (
                <Button type="button" variant="secondary" size="icon" className="size-9" aria-label="Stop" onClick={() => abort.current?.abort()}><Square className="fill-current" /></Button>
              ) : (
                <Button type="submit" variant="primary" size="icon" className="size-9" aria-label="Send" disabled={!input.trim()}><ArrowUp /></Button>
              )}
            </div>
            <p className="mt-1.5 px-1 text-[10px] text-muted">Enter to send · Shift+Enter for a new line · {mode === "ai" ? "AI can misread data; verified figures are marked." : "Rule-based answers, no AI model; verified figures are marked."}</p>
          </form>
        </m.aside>
      )}
    </AnimatePresence>
  );
}

function TurnView({ turn, isLast, onFollowup }: { turn: Turn; isLast: boolean; onFollowup: (q: string) => void }) {
  const g = turn.final?.grounding;
  const streaming = turn.status === "streaming";
  return (
    <div className="space-y-3">
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[var(--accent)] px-3.5 py-2 text-sm text-white shadow-md shadow-[var(--accent)]/20">{turn.question}</div>

      {turn.steps.length > 0 && <AgentTimeline steps={turn.steps} done={!streaming} />}

      {streaming && turn.steps.length === 0 && !turn.answer && (
        <div className="flex items-center gap-2 text-xs text-muted"><Loader2 className="size-3.5 animate-spin" /> {turn.backend === "offline" ? "Offline analyst is routing your question..." : "AI model is choosing which data to pull..."}</div>
      )}

      {turn.answer && (
        <div className="prose-chat text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.answer}</ReactMarkdown>
          {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[var(--accent)] align-text-bottom" />}
        </div>
      )}

      {turn.status === "error" && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">Could not answer: {turn.error}. Check that the API is running.</p>}
      {turn.status === "stopped" && <p className="text-xs text-muted">Stopped.</p>}

      {turn.final && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {g && g.numbers_checked > 0 && (
              <Tooltip content={g.ungrounded.length ? `Not found in tool output: ${g.ungrounded.join(", ")}` : "Every number in this answer was traced back to the CMS data the tools returned."}>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset", g.ungrounded.length ? "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400")}>
                  {g.ungrounded.length ? <ShieldAlert className="size-3" /> : <ShieldCheck className="size-3" />}
                  {g.numbers_grounded}/{g.numbers_checked} figures verified
                </span>
              </Tooltip>
            )}
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-muted">{turn.final.backend === "ollama" ? `AI model: ${turn.final.model}` : "Offline analyst (rule-based, no AI model)"} · {turn.final.latency_s.toFixed(1)}s</span>
          </div>
          {turn.final.notes.map((n) => <p key={n} className="text-[11px] text-muted">{n}</p>)}
          {turn.final.sources.length > 0 && <Sources final={turn.final} />}
          {isLast && turn.final.followups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {turn.final.followups.map((f) => (
                <button key={f} onClick={() => onFollowup(f)} className="rounded-full px-2.5 py-1 text-xs text-[var(--accent)] ring-1 ring-inset ring-[var(--accent)]/30 transition hover:bg-[var(--accent)]/10">
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentTimeline({ steps, done }: { steps: Step[]; done: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-xl bg-foreground/[0.03] ring-1 ring-inset ring-border">
      <Collapsible.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted">
        {done ? <Check className="size-3.5 text-emerald-500" /> : <Loader2 className="size-3.5 animate-spin text-[var(--accent)]" />}
        <span className="font-medium text-foreground/80">{done ? `Used ${steps.length} tool${steps.length > 1 ? "s" : ""}` : "Working"}</span>
        <ChevronDown className={cn("ml-auto size-3.5 transition", open && "rotate-180")} />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <ol className="space-y-1.5 px-3 pb-2.5">
          <AnimatePresence initial={false}>
            {steps.map((s, i) => (
              <m.li key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5">
                  {s.status === "running" ? <Loader2 className="size-3 animate-spin text-[var(--accent)]" /> : s.status === "done" ? <Check className="size-3 text-emerald-500" /> : <X className="size-3 text-rose-500" />}
                </span>
                <span className="min-w-0">
                  <span className="text-foreground/85">{TOOL_LABEL[s.name] ?? s.name}</span>
                  {s.summary && <span className="text-muted"> · {s.summary}</span>}
                  <span className="block truncate font-mono text-[10px] text-muted/80">{s.name}({Object.entries(s.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")})</span>
                </span>
              </m.li>
            ))}
          </AnimatePresence>
        </ol>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function Sources({ final }: { final: FinalEvent }) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger className="group flex items-center gap-1.5 text-[11px] text-muted hover:text-foreground">
        <BookOpen className="size-3" /> {final.sources.length} source{final.sources.length > 1 ? "s" : ""}
        <ChevronDown className="size-3 transition group-data-[state=open]:rotate-180" />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <ul className="mt-1.5 space-y-1.5">
          {final.sources.map((s, i) => (
            <li key={i} className="rounded-lg bg-foreground/[0.03] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted ring-1 ring-inset ring-border">
              {s.url ? (
                <a href={s.url.startsWith("http") ? s.url : undefined} target="_blank" rel="noreferrer" className="font-medium text-foreground/85 hover:underline">{s.title ?? s.dataset}</a>
              ) : (
                <>
                  <span className="font-medium text-foreground/85">{s.dataset}</span>
                  <span className="block">FY{s.year} · CCN {s.ccn} · report {s.report_id} · {s.fiscal_period}</span>
                  {s.fields && s.fields.length > 0 && <span className="block truncate">Fields: {s.fields.slice(0, 6).join(", ")}{s.fields.length > 6 ? "..." : ""}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
