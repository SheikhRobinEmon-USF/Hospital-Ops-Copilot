"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { forwardRef, useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";

import type { Status } from "@/lib/api";
import { cn, STATUS_STYLE } from "@/lib/utils";

/* ---------------------------------------------------------------- Button */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 " +
    "active:scale-[0.98] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_oklch,var(--accent)_70%,var(--accent-2))] text-white shadow-lg shadow-[var(--accent)]/20 hover:brightness-110",
        secondary: "glass hover:bg-[var(--surface-strong)]",
        ghost: "hover:bg-foreground/5 text-foreground/80 hover:text-foreground",
        outline: "border border-border hover:bg-foreground/5",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-9 px-3.5", lg: "h-11 px-5", icon: "size-9" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";

/* ---------------------------------------------------------------- Card */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass rounded-2xl shadow-sm shadow-black/5", className)} {...props} />;
}

export function CardHeader({ title, description, action, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 grid size-8 place-items-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] [&_svg]:size-4">{icon}</div>}
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- Badges */

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", s.chip, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-foreground/75 ring-1 ring-inset ring-border", className)}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

/* ---------------------------------------------------------------- Segmented control */

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  size = "md",
  layoutId,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  size?: "sm" | "md";
  layoutId: string;
}) {
  return (
    <div role="radiogroup" className="relative inline-flex rounded-lg bg-foreground/5 p-0.5 ring-1 ring-inset ring-border">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active ? "text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-md bg-[var(--surface-strong)] shadow-sm ring-1 ring-border"
                transition={{ type: "spring", bounce: 0.18, duration: 0.45 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- AnimatedNumber */

/** Counts up to a value with a spring. Kinetic typography for KPI figures. */
export function AnimatedNumber({ value, format, className }: { value: number | null; format: (v: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value ?? 0);
  const spring = useSpring(mv, { stiffness: 90, damping: 20, mass: 0.6 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    if (value !== null) mv.set(value);
  }, [mv, value]);
  if (value === null) return <span className={className}>n/a</span>;
  if (reduce) return <span className={cn("tabular", className)}>{format(value)}</span>;
  return <motion.span className={cn("tabular", className)}>{text}</motion.span>;
}

/* ---------------------------------------------------------------- Empty / error */

export function ErrorState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {detail && <p className="mt-1 max-w-md text-xs text-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>
  );
}
