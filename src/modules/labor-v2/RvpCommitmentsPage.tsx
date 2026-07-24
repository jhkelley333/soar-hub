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
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  fetchRvpCommitments, setRvpCommitment, deleteRvpCommitment, setRvpCommitmentBuckets,
  type CommitMetric, type RvpCommitmentRow, type RvpCommitWeek,
} from "./api";

const BUCKET_ROLES = ["vp", "coo", "admin"];

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
const fmtUsd = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
// Savings over the next 30 days from a per-week rate.
const per30 = (weekly: number | null) => (weekly == null ? null : Math.round((weekly * 30) / 7));

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

// Trend ticker: ▲/▼ vs the previous point, colored green if the move is good for
// this metric (up-good vs down-good), red if worse, grey if flat.
function tick(value: number, prev: number, dir: Dir): { sym: string; good: boolean | null } {
  if (value === prev) return { sym: "→", good: null };
  const up = value > prev;
  return { sym: up ? "▲" : "▼", good: dir === "up" ? up : !up };
}

function WeeklyStrip({ series, baseline, m }: { series: RvpCommitWeek[]; baseline: number | null; m: MetricDef }) {
  let last = baseline;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-zinc-300">Track</span>
      {series.map((w) => {
        const val = w.value;
        const arrow = val != null && last != null ? tick(val, last, m.dir) : null;
        if (val != null) last = val;
        return (
          <div key={w.weekEnd}
            title={`Week ending ${w.weekEnd}`}
            className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] tabular-nums",
              val == null ? "border-dashed border-zinc-200 text-zinc-300" : "border-zinc-200 text-zinc-600")}>
            <span className="text-zinc-400">{fmtWeek(w.weekEnd)}</span>
            <span>{val == null ? "—" : fmtVal(val, m)}</span>
            {arrow && <span className={arrow.good == null ? "text-zinc-400" : arrow.good ? "text-emerald-600" : "text-red-600"}>{arrow.sym}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function RvpCommitmentsPage() {
  const { profile } = useAuth();
  const canEditBuckets = BUCKET_ROLES.includes(profile?.role ?? "");
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rvp-commitments"], queryFn: fetchRvpCommitments });

  const hidden = q.data?.hidden_metrics ?? [];

  const setBuckets = useMutation({
    mutationFn: (next: CommitMetric[]) => setRvpCommitmentBuckets(next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rvp-commitments"] }),
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update buckets.", "error"),
  });
  const toggleBucket = (key: CommitMetric) => {
    const next = hidden.includes(key) ? hidden.filter((h) => h !== key) : [...hidden, key];
    setBuckets.mutate(next);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <PageHeader title="RVP Commitments" description="Each region's committed target vs. its live actual, tracked weekly." />

      {q.isLoading && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>}
      {q.isError && <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />}
      {q.data && q.data.rows.length === 0 && (
        <EmptyState title="No regions in scope" description="No labor data or regions available yet." />
      )}

      {q.data && q.data.rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-xs text-zinc-500">
              Labor metrics are this fiscal week to date
              {q.data.week ? <> ({fmtWeek(q.data.week.start)}–{fmtWeek(q.data.week.end)})</> : null}.
              COGS Efficiency is the latest ranking run. <strong>4-wk base</strong> is the last-four-weeks
              average (click to seed a target). <strong>Track</strong> = the 30-day window
              {q.data.tracking.end ? <> through {fmtWeek(q.data.tracking.end)}</> : null}; each week fills in with an up/down ticker as it closes.
            </p>
            {canEditBuckets && (
              <div className="flex flex-wrap items-center gap-1.5" title="Default buckets — applies to any RVP you haven't customized below.">
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">Default buckets</span>
                {METRICS.map((m) => {
                  const on = !hidden.includes(m.key);
                  return (
                    <button key={m.key} onClick={() => toggleBucket(m.key)} disabled={setBuckets.isPending}
                      className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                        on ? "border-accent-200 bg-accent-50 text-accent-700" : "border-zinc-200 bg-white text-zinc-400 line-through")}>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {q.data.totals.total_weekly != null && (
            <div className="rounded-xl bg-midnight px-4 py-3 text-white ring-1 ring-black/5">
              <div className="text-[11px] uppercase tracking-wide text-white/60">Savings if every gap closes · next 30 days</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-2xl font-semibold tabular-nums">{fmtUsd(per30(q.data.totals.total_weekly))}<span className="ml-1 text-sm font-normal text-white/60">/ 30 days</span></span>
                <span className="text-sm tabular-nums text-white/80">{fmtUsd(q.data.totals.total_annual)}<span className="text-white/50">/yr</span></span>
                <span className="text-[11px] text-white/50">Labor {fmtUsd(per30(q.data.totals.labor_weekly))} · COGS {fmtUsd(per30(q.data.totals.cogs_weekly))} over 30 days · to chart / 96% target</span>
              </div>
            </div>
          )}
          <div className="space-y-4">
            {q.data.rows.filter((row) => row.rvp_name && row.stores > 0)
              .map((row) => <RvpCard key={row.region} row={row} canEdit={canEditBuckets} />)}
          </div>
        </>
      )}
    </div>
  );
}

function RvpCard({ row, canEdit }: { row: RvpCommitmentRow; canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editBuckets, setEditBuckets] = useState(false);
  const hidden = row.hidden_metrics ?? [];
  const metrics = METRICS.filter((m) => !hidden.includes(m.key));

  const setBuckets = useMutation({
    mutationFn: (next: CommitMetric[]) => setRvpCommitmentBuckets(next, row.region),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rvp-commitments"] }),
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't update buckets.", "error"),
  });
  const toggle = (key: CommitMetric) =>
    setBuckets.mutate(hidden.includes(key) ? hidden.filter((h) => h !== key) : [...hidden, key]);

  return (
    <div className="rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-midnight">{row.rvp_name ?? "Unassigned RVP"}</div>
          <div className="text-xs text-zinc-400">{row.region} · {row.stores} store{row.stores === 1 ? "" : "s"}</div>
        </div>
        <div className="flex items-center gap-2">
          {row.cogs_week && <div className="text-[11px] text-zinc-400">COGS wk {fmtWeek(row.cogs_week)}</div>}
          {canEdit && (
            <button onClick={() => setEditBuckets((v) => !v)}
              className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 transition",
                editBuckets ? "bg-accent-50 text-accent-700 ring-accent-200" : "text-zinc-500 ring-zinc-200 hover:bg-zinc-50")}>
              Buckets
            </button>
          )}
        </div>
      </div>
      {canEdit && editBuckets && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2">
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">Track for this RVP</span>
          {METRICS.map((m) => {
            const on = !hidden.includes(m.key);
            return (
              <button key={m.key} onClick={() => toggle(m.key)} disabled={setBuckets.isPending}
                className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                  on ? "border-accent-200 bg-accent-50 text-accent-700" : "border-zinc-200 bg-white text-zinc-400 line-through")}>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="divide-y divide-zinc-100">
        {metrics.length === 0
          ? <div className="px-4 py-4 text-xs text-zinc-400">No buckets selected for this RVP.</div>
          : metrics.map((m) => <MetricRow key={m.key} row={row} m={m} />)}
      </div>
      {row.dollars.total_weekly != null && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">$ if gap closes · 30 days</span>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs tabular-nums text-zinc-600">
            <span>Labor <b className="text-midnight">{fmtUsd(per30(row.dollars.labor_weekly))}</b></span>
            <span>COGS <b className="text-midnight">{fmtUsd(per30(row.dollars.cogs_weekly))}</b></span>
            <span className="text-emerald-700">Total <b>{fmtUsd(per30(row.dollars.total_weekly))}</b> / 30d</span>
            <span className="text-zinc-400">({fmtUsd(row.dollars.total_annual)}/yr)</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricRow({ row, m }: { row: RvpCommitmentRow; m: MetricDef }) {
  const toast = useToast();
  const qc = useQueryClient();
  const actual = row.actuals[m.key];
  const target = row.targets[m.key];
  const baseline = row.baselines[m.key];
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
    <div className="px-4 py-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-[150px] flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-midnight">
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{m.group}</span>
          {m.label}
          <span className="text-[10px] font-normal uppercase tracking-wide text-zinc-400">{m.grain}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-400">{m.hint}</div>
      </div>

      {/* 4-week baseline */}
      <div className="w-24 text-right">
        <div className="text-[10px] uppercase tracking-wide text-zinc-400">4-wk base</div>
        {baseline == null ? (
          <div className="text-sm tabular-nums text-zinc-400">—</div>
        ) : (
          <button
            title="Use as target"
            onClick={() => { setVal(String(baseline)); setEditing(true); }}
            className="text-sm font-medium tabular-nums text-zinc-600 underline decoration-dotted underline-offset-2 hover:text-accent-700">
            {fmtVal(baseline, m)}
          </button>
        )}
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
      <WeeklyStrip series={row.weekly[m.key] ?? []} baseline={baseline} m={m} />
    </div>
  );
}
