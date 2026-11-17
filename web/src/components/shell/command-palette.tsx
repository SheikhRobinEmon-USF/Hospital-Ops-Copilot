"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Building2, CornerDownLeft, Loader2, Sparkles } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { titleCase } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

import { NAV } from "./shell";

const QUICK_QUESTIONS = [
  "How do we compare to our peers?",
  "What are our biggest savings opportunities?",
  "How has our operating margin changed over time?",
  "What if volume grows 5% and labor costs rise 3%?",
];

/** ⌘K: switch hospital, jump to a section, or ask the copilot. */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, set, askCopilot } = useWorkspace();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const search = useQuery({
    queryKey: ["search", deferred],
    queryFn: ({ signal }) => api.search(deferred, signal),
    enabled: deferred.length >= 2,
    staleTime: 60_000,
  });

  // Keep the highlight on the best hospital match once results arrive; otherwise an "Ask copilot" row that
  // rendered first would stay highlighted and Enter would ask a question instead of opening the hospital.
  const [selected, setSelected] = useState("");
  const firstHit = search.data?.[0]?.ccn;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (firstHit) setSelected(`h-${firstHit}`);
  }, [firstHit, deferred]);

  const close = () => {
    setPaletteOpen(false);
    setQuery("");
    setSelected("");
  };

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={(o) => (o ? setPaletteOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl bg-[var(--surface-strong)] shadow-2xl ring-1 ring-border">
          <Dialog.Title className="sr-only">Search hospitals and actions</Dialog.Title>
          <Command shouldFilter={false} loop value={selected} onValueChange={setSelected}>
            <div className="flex items-center gap-3 border-b border-border px-4">
              {search.isFetching ? <Loader2 className="size-4 animate-spin text-muted" /> : <Building2 className="size-4 text-muted" />}
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search 6,000+ hospitals by name, city, or CCN, or type a question..."
                className="h-14 w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {deferred.length >= 2 && (
                <Command.Group heading="Hospitals" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
                  {search.data?.length === 0 && <p className="px-2 py-3 text-sm text-muted">No hospitals match &ldquo;{deferred}&rdquo;.</p>}
                  {search.data?.map((h) => (
                    <Command.Item
                      key={h.ccn}
                      value={`h-${h.ccn}`}
                      onSelect={() => {
                        set({ ccn: h.ccn });
                        close();
                      }}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-foreground/[0.07]"
                    >
                      <div className="grid size-8 place-items-center rounded-lg bg-[var(--accent)]/10 text-[11px] font-semibold text-[var(--accent)]">{h.state}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{titleCase(h.name)}</p>
                        <p className="truncate text-xs text-muted">
                          {h.city} · {h.facility_type_desc} · {h.beds ?? "?"} beds · CCN {h.ccn}
                        </p>
                      </div>
                      <CornerDownLeft className="size-3.5 text-muted opacity-0 [[data-selected=true]_&]:opacity-100" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {query.trim().length > 6 && (
                <Command.Group heading="Copilot" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
                  <Command.Item
                    value="ask-typed"
                    onSelect={() => {
                      askCopilot(query.trim());
                      close();
                    }}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-foreground/[0.07]"
                  >
                    <Sparkles className="size-4 text-[var(--accent)]" />
                    Ask copilot: <span className="truncate text-muted">{query.trim()}</span>
                  </Command.Item>
                </Command.Group>
              )}
              {deferred.length < 2 && (
                <>
                  <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
                    {NAV.map((n) => (
                      <Command.Item
                        key={n.id}
                        value={`nav-${n.id}`}
                        onSelect={() => {
                          set({ section: n.id });
                          close();
                        }}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-foreground/[0.07] [&_svg]:size-4 [&_svg]:text-muted"
                      >
                        {n.icon}
                        {n.label}
                        <span className="ml-auto text-xs text-muted">{n.hint}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Ask the copilot" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
                    {QUICK_QUESTIONS.map((q) => (
                      <Command.Item
                        key={q}
                        value={q}
                        onSelect={() => {
                          askCopilot(q);
                          close();
                        }}
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm data-[selected=true]:bg-foreground/[0.07]"
                      >
                        <Sparkles className="size-4 text-[var(--accent)]" />
                        {q}
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
