"use client";

import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-xs rounded-lg bg-[var(--surface-strong)] px-3 py-2 text-xs leading-relaxed text-foreground shadow-xl ring-1 ring-border",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
