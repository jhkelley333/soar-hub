// RVP Commitments — each region commits to a target per metric; this page
// tracks the live actual against it. Labor metrics are current-fiscal-week WTD
// (from the labor engine); COGS Efficiency is the latest weekly IX food-cost
// upload. Targets are editable inline (backend enforces region scope).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  fetchRvpCommitments, setRvpCommitment, deleteRvpCommitment,
  type CommitMetric, type RvpCommitmentRow,
} from "./api";

type Dir = "up" | "down";
interface MetricDef { key: CommitMetric; group: "Labor" | "COGS"; label: string; unit: "h" | "%"; dir: Dir; grain: string; hint: string; }
const METRICS: MetricDef[] = [
  { key: "labor_hours_over", group: "Labor", label: "Hours Over Chart", unit: "h", dir: "down", grain: "WTD",
    hint: "Week-to-date hours over chart per store (credit-adjusted). A cap — lower is better." },
  { key: "labor_avs_pct", group: "Labor", label: "Actual vs Scheduled", unit: "%", dir: "down", grain: "WTD",
    hint: "Actual ÷ scheduled hours, week-to-date. A cap — lower/closer to 100% is better." },
  { key: "cogs_efficiency", group: "COGS", label: "COGS Efficiency", unit: "%", dir: "up", grain: "weekly",
    hint: "Latest IX food-cost efficiency (ideal ÷ actual). A floor — higher is better." },
];

const fmtVal = (v: number | null, m: MetricDef) => {
  if (v == null) return "—";
  if (m.unit === "h") return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}h`;
  return `${v.toFixed(1)}%`;
};
const fmtTarget = (v: number | null, m: MetricDef) =>
  v == null ? "—" : `${m.dir === "up" ? "≥" : "≤"} ${m.unit === "h" ? `${v}h` : `${v}%`}`;
const fmtWeek = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Track = "on" | "off" | "no-target" | "no-data";
function track(actual: number | null, target: number | null, dir: Dir): Track {
  if (target == null) return "no-target";
  if (actual == null) return "no-data";
  return (dir === "up" ? actual >= target : actual <= target) ? "on" : "off";
}
const TRACK_STYLE: Record<Track, { label: string; cls: string }> = {
  on: { label: "On track", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  off: { label: "Off track", cls: "bg-red-50 text-red-700 ring-red-200" },
  "no-target": { label: "No target", cls: "bg-zinc-50 text-zinc-400 ring-zinc-200" },
  "no-data": { label: "No data", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};

export function RvpCommitmentsPage() {
  const q = useQuery({ queryKey: ["rvp-commitments"], queryFn: fetchRvpCommitments });

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader title="RVP Commitments" description="Each region's committed target vs. its live actual." />

      {q.isLoading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>}
      {q.isError && <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />}
      {q.data && q.data.rows.length === 0 && (
        <EmptyState title="No regions in scope" description="No labor data or regions available yet." />
      )}

      {q.data && q.data.rows.length > 0 && (
        <>
          <p className="text-xs text-zinc-500">
            Labor metrics are this fiscal week to date
            {q.data.week ? <> ({fmtWeek(q.data.week.start)}–{fmtWeek(q.data.week.end)})</> : null}.
            COGS Efficiency is the latest weekly food-cost upload. Click a target to edit.
          </p>
          <div className="space-y-4">
            {q.data.rows.map((row) => <RvpCard key={row.region} row={row} />)}
          </div>
        </>
      )}
    </div>
  );
}

function RvpCard({ row }: { row: RvpCommitmentRow }) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-midnight">{row.rvp_name ?? "Unassigned RVP"}</div>
          <div className="text-xs text-zinc-400">{row.region} · {row.stores} store{row.stores === 1 ? "" : "s"}</div>
        </div>
        {row.cogs_week && <div className="text-[11px] text-zinc-400">COGS wk {fmtWeek(row.cogs_week)}</div>}
      </div>
      <div className="divide-y divide-zinc-100">
        {METRICS.map((m) => <MetricRow key={m.key} row={row} m={m} />)}
      </div>
    </div>
  );
}

function MetricRow({ row, m }: { row: RvpCommitmentRow; m: MetricDef }) {
  const toast = useToast();
  const qc = useQueryClient();
  const actual = row.actuals[m.key];
  const target = row.targets[m.key];
  const status = track(actual, target, m.dir);
  const st = TRACK_STYLE[status];

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(target != null ? String(target) : "");

  const save = useMutation({
    mutationFn: () => setRvpCommitment({ region: row.region, metric: m.key, target_value: Number(val) }),
    onSuccess: () => { toast.push("Target saved.", "success"); setEditing(false); qc.invalidateQueries({ queryKey: ["rvp-commitments"] }); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });
  const clear = useMutation({
    mutationFn: () => deleteRvpCommitment(row.region, m.key),
    onSuccess: () => { toast.push("Target cleared.", "success"); setEditing(false); qc.invalidateQueries({ queryKey: ["rvp-commitments"] }); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't clear.", "error"),
  });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-[150px] flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-midnight">
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{m.group}</span>
          {m.label}
          <span className="text-[10px] font-normal uppercase tracking-wide text-zinc-400">{m.grain}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-400">{m.hint}</div>
      </div>

      {/* Actual */}
      <div className="w-20 text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">Actual</div>
        <div className={cn("text-sm font-semibold tabular-nums",
          status === "on" ? "text-emerald-600" : status === "off" ? "text-red-600" : "text-zinc-500")}>
          {fmtVal(actual, m)}
        </div>
      </div>

      {/* Target (editable) */}
      <div className="w-28 text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">Target</div>
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <input type="number" step={m.unit === "h" ? "0.5" : "0.1"} value={val} autoFocus
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && val) save.mutate(); if (e.key === "Escape") setEditing(false); }}
              className="w-16 rounded border border-zinc-300 px-1.5 py-0.5 text-right text-sm focus:border-accent focus:outline-none" />
            <button title="Save" disabled={!val || save.isPending} onClick={() => save.mutate()}
              className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"><Check className="h-3.5 w-3.5" /></button>
            <button title="Cancel" onClick={() => { setEditing(false); setVal(target != null ? String(target) : ""); }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-50"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => { setVal(target != null ? String(target) : ""); setEditing(true); }}
            className="group inline-flex items-center gap-1 text-sm font-medium tabular-nums text-zinc-700 hover:text-accent-700">
            {fmtTarget(target, m)}
            <Pencil className="h-3 w-3 text-zinc-300 group-hover:text-accent-600" />
          </button>
        )}
        {!editing && target != null && (
          <button onClick={() => clear.mutate()} disabled={clear.isPending}
            className="mt-0.5 block w-full text-right text-[10px] text-zinc-300 hover:text-red-500">clear</button>
        )}
      </div>

      {/* Status */}
      <div className="w-20 text-right">
        <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", st.cls)}>{st.label}</span>
      </div>
    </div>
  );
}
