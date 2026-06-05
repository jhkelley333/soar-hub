// Cash Management — small presentational primitives shared by the tabs.
// Tailwind-native (cash-green = emerald, warn = amber, breach = red) so the
// module sits "under one roof" with the rest of the hub.

import { useState } from "react";
import { Info, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

// Click-to-toggle info popover (a little "i"). Body text passed as children.
export function InfoDot({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="grid h-4 w-4 place-items-center rounded-full text-zinc-400 transition hover:text-zinc-600"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-5 top-0 z-20 w-72 rounded-md border border-zinc-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-zinc-600 shadow-lg">
          {children}
        </div>
      )}
    </span>
  );
}

type Tone = "neutral" | "green" | "red" | "amber" | "blue";

const TONE: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
};

export function Pill({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", TONE[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_MAP: Record<string, [Tone, string]> = {
  verified: ["green", "Verified"],
  "awaiting-deposit": ["amber", "Awaiting deposit"],
  flagged: ["red", "Flagged"],
  pending: ["amber", "Pending"],
  open: ["red", "Open"],
  acknowledged: ["blue", "Acknowledged"],
  resolved: ["green", "Resolved"],
};
export function StatusPill({ status }: { status: string }) {
  const [tone, label] = STATUS_MAP[status] ?? (["neutral", status] as [Tone, string]);
  return (
    <Pill tone={tone} dot>
      {label}
    </Pill>
  );
}

export function severityTone(sev: string): Tone {
  return sev === "high" ? "red" : sev === "medium" ? "amber" : "neutral";
}

// Big stat figure used across the dashboard / DSR / alert summaries.
export function Figure({
  label,
  value,
  sub,
  tone,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "red" | "green";
  mono?: boolean;
}) {
  const color = tone === "red" ? "text-red-700" : tone === "green" ? "text-emerald-700" : "text-midnight";
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={cn("mt-2 text-3xl font-semibold leading-none", mono && "tabular-nums", color)}>{value}</div>
      {sub && <div className="mt-1.5 text-[13px] text-zinc-500">{sub}</div>}
    </div>
  );
}

// $-prefixed numeric input.
export function MoneyInput({
  value,
  onChange,
  accent,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  accent?: "red";
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">$</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "block w-full rounded-md border-0 bg-white py-2.5 pl-7 pr-3 text-lg font-semibold tabular-nums ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent",
          accent === "red" ? "text-red-700" : "text-midnight"
        )}
      />
    </div>
  );
}

// −/n/+ quantity stepper for the denomination counter.
export function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(0, v));
  return (
    <div className="inline-flex items-center overflow-hidden rounded-md ring-1 ring-inset ring-zinc-200">
      <button
        type="button"
        onClick={() => set(value - 1)}
        className="grid h-8 w-8 place-items-center bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => set(parseInt(e.target.value || "0", 10))}
        className="h-8 w-12 border-x border-zinc-200 text-center text-sm font-semibold tabular-nums focus:outline-none"
      />
      <button
        type="button"
        onClick={() => set(value + 1)}
        className="grid h-8 w-8 place-items-center bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
