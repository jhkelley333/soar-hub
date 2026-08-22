// RVP Period Commitments (Phase 6, metric-anchored redesign) — each RVP anchors
// a commitment to a Ranker metric, records a 4-week baseline + target, and lists
// the SPECIFIC actions (what / owner / cadence / expected impact) that will move
// it. An info panel frames how to write a commitment worth reading — through the
// lens of a Director of Finance from McKinsey/Amazon: anchor to a number, state
// the gap and date, decompose the driver, commit to controllable inputs, make
// each action specific, and prove the math adds up. Every edit is captured in an
// immutable history the DB writes by trigger and this page shows per commitment.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowRight, ChevronLeft, ChevronRight, History, Info, Pencil, Plus, Sparkles,
  Target, Trash2, TrendingDown, TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { FISCAL, fiscalInfo } from "@/lib/fiscal";
import {
  fetchPeriodCommitments, createPeriodCommitment, updatePeriodCommitment, fetchMetricSeries,
  type PeriodCommitment, type CommitmentStatus, type CommitmentHistoryRow,
  type CommitmentAction, type MetricSeries, type RvpOption,
} from "./api";
import {
  METRIC_GROUPS, METRICS_BY_KEY, impactUnit, gapInImpactUnit, fmtGap, fmtMetricValue,
  type RankerMetric,
} from "./metrics";

const STATUS_STYLE: Record<CommitmentStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-accent-100 text-accent-700 ring-accent-200" },
  met: { label: "Met", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  missed: { label: "Missed", cls: "bg-red-50 text-red-700 ring-red-200" },
};
const STATUSES: CommitmentStatus[] = ["active", "met", "missed"];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const FIELD_LABEL: Record<string, string> = {
  commitment_text: "Objective", metric: "Metric", baseline_value: "Baseline",
  target_value: "Target", target_unit: "Unit", actions: "Actions", status: "Status",
};

interface ActionDraft { what: string; owner: string; cadence: string; impact: string }

type Draft = {
  id?: string;
  rvp_user_id: string;
  metric_key: string;
  commitment_text: string;
  baseline_value: string;
  target_value: string;
  actions: ActionDraft[];
  status: CommitmentStatus;
};

const emptyAction = (): ActionDraft => ({ what: "", owner: "", cadence: "", impact: "" });
const toNum = (s: string): number | null => (s.trim() === "" ? null : Number(s));

const inputCls =
  "block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-ink ring-1 ring-inset ring-border focus:outline-none focus:ring-2 focus:ring-accent";

export function PeriodCommitmentsPage() {
  const now = useMemo(() => new Date(), []);
  const currentPeriod = fiscalInfo(now)?.period ?? 1;
  const [period, setPeriod] = useState(currentPeriod);
  const fiscalYear = FISCAL.label;

  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["period-commitments", fiscalYear, period],
    queryFn: () => fetchPeriodCommitments(fiscalYear, period),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["period-commitments", fiscalYear, period] });

  const [editing, setEditing] = useState<Draft | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const isNew = editing != null && !editing.id;
  const rvps = q.data?.rvps ?? [];
  const isLeader = q.data?.scope === "all";
  const selfId = q.data?.self_id ?? "";

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const metric = METRICS_BY_KEY[d.metric_key] ?? null;
      const actions: CommitmentAction[] = d.actions
        .map((a) => ({
          what: a.what.trim() || null,
          owner: a.owner.trim() || null,
          cadence: a.cadence.trim() || null,
          impact: a.impact.trim() === "" ? null : Number(a.impact),
        }))
        .filter((a) => a.what || a.owner || a.cadence || a.impact != null);
      const common = {
        metric_key: d.metric_key || null,
        metric_label: metric?.label ?? null,
        baseline_value: toNum(d.baseline_value),
        commitment_text: d.commitment_text,
        target_value: toNum(d.target_value),
        target_unit: metric?.unit || null,
        actions,
        status: d.status,
      };
      if (d.id) return updatePeriodCommitment({ id: d.id, ...common });
      return createPeriodCommitment({
        fiscal_year: fiscalYear, period, ...common,
        rvp_user_id: d.rvp_user_id || undefined,
      });
    },
    onSuccess: () => { toast.push("Saved.", "success"); invalidate(); setEditing(null); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const openNew = () => setEditing({
    // Leaders must pick which RVP the commitment is for before we can pull that
    // RVP's baseline; an RVP is always themselves.
    rvp_user_id: isLeader ? "" : selfId, metric_key: "", commitment_text: "",
    baseline_value: "", target_value: "", actions: [emptyAction()], status: "active",
  });
  const openEdit = (c: PeriodCommitment) => setEditing({
    id: c.id, rvp_user_id: c.rvp_user_id, metric_key: c.metric_key ?? "",
    commitment_text: c.commitment_text,
    baseline_value: c.baseline_value == null ? "" : String(c.baseline_value),
    target_value: c.target_value == null ? "" : String(c.target_value),
    actions: c.actions.length
      ? c.actions.map((a) => ({
          what: a.what ?? "", owner: a.owner ?? "", cadence: a.cadence ?? "",
          impact: a.impact == null ? "" : String(a.impact),
        }))
      : [emptyAction()],
    status: c.status,
  });

  const stepPeriod = (delta: number) => setPeriod((p) => Math.min(12, Math.max(1, p + delta)));

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Period Commitments"
        description="Anchor a commitment to a Ranker metric, set a 4-week baseline and target, and list the specific actions that will move it."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setGuideOpen(true)} title="How to write a commitment worth reading">
              <Info className="mr-1 h-3.5 w-3.5" /> How to write one
            </Button>
            <Button size="sm" onClick={openNew} disabled={q.isLoading}><Plus className="mr-1 h-3.5 w-3.5" /> New commitment</Button>
          </div>
        }
      />

      {/* Period selector */}
      <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-2.5 ring-1 ring-border">
        <button onClick={() => stepPeriod(-1)} disabled={period <= 1}
          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted disabled:opacity-30" aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-heading">{fiscalYear} · Period {period}</div>
          {period === currentPeriod && <div className="text-[11px] font-medium uppercase tracking-wide text-accent">Current period</div>}
        </div>
        <button onClick={() => stepPeriod(1)} disabled={period >= 12}
          className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted disabled:opacity-30" aria-label="Next period">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {q.isLoading && <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>}
      {q.isError && <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />}
      {q.data && q.data.commitments.length === 0 && (
        <EmptyState
          title={`No commitments for Period ${period}`}
          description={isLeader ? "No RVP has recorded a commitment for this period yet." : "You haven't recorded a commitment for this period yet."}
        />
      )}

      {q.data && q.data.commitments.length > 0 && (
        <div className="space-y-3">
          {q.data.commitments.map((c) => (
            <CommitmentCard key={c.id} c={c} showRvp={isLeader} onEdit={() => openEdit(c)} />
          ))}
        </div>
      )}

      <CommitmentModal
        draft={editing} isNew={isNew} isLeader={isLeader} rvps={rvps} period={period}
        saving={save.isPending}
        onChange={setEditing}
        onOpenGuide={() => setGuideOpen(true)}
        onClose={() => setEditing(null)}
        onSave={() => editing && save.mutate(editing)}
      />
      <GuidanceModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function CommitmentCard({ c, showRvp, onEdit }: { c: PeriodCommitment; showRvp: boolean; onEdit: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const st = STATUS_STYLE[c.status];
  const metric = c.metric_key ? METRICS_BY_KEY[c.metric_key] ?? null : null;
  const gap = gapInImpactUnit(metric, c.baseline_value, c.target_value);
  const gapLabel = fmtGap(metric, gap);
  const baseLabel = fmtMetricValue(metric, c.baseline_value);
  const targetLabel = fmtMetricValue(metric, c.target_value);
  const actions = c.actions ?? [];

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {showRvp && <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{c.rvp_name ?? "Unassigned RVP"}</div>}
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", st.cls)}>{st.label}</span>
              {c.metric_label && (
                <span className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold text-heading ring-1 ring-border">
                  <Target className="h-3 w-3" /> {c.metric_label}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-ink">{c.commitment_text}</p>

            {(baseLabel != null || targetLabel != null) && (
              <div className="mt-2.5 inline-flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted px-3 py-1.5 text-xs ring-1 ring-border">
                <span className="text-ink-muted">Baseline <span className="font-semibold tabular-nums text-ink">{baseLabel ?? "—"}</span></span>
                <ArrowRight className="h-3.5 w-3.5 text-ink-subtle" />
                <span className="text-ink-muted">Target <span className="font-semibold tabular-nums text-ink">{targetLabel ?? "—"}</span></span>
                {gapLabel && (
                  <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
                    gap! >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                    {gap! >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {gapLabel}
                  </span>
                )}
              </div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit} className="shrink-0"><Pencil className="h-3.5 w-3.5" /></Button>
        </div>

        {metric && c.series && c.series.weeks.length > 0 && (
          <MovementTracker
            metric={metric}
            baseline={c.series.baseline ?? c.baseline_value}
            target={c.target_value}
            series={c.series}
          />
        )}

        {actions.length > 0 && (
          <ol className="mt-3 space-y-2 border-t border-border pt-3">
            {actions.map((a, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas text-[11px] font-bold text-heading">{i + 1}</span>
                <div className="min-w-0">
                  {a.what && <div className="text-ink">{a.what}</div>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-muted">
                    {a.owner && <span><span className="text-ink-subtle">Owner</span> {a.owner}</span>}
                    {a.cadence && <span><span className="text-ink-subtle">Cadence</span> {a.cadence}</span>}
                    {a.impact != null && (
                      <span className="font-semibold tabular-nums text-heading">
                        {a.impact > 0 ? "+" : ""}{a.impact} {impactUnit(metric)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {c.history.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <button onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted hover:text-accent">
              <History className="h-3.5 w-3.5" />
              {showHistory ? "Hide" : "Show"} edit history · {c.history.length}
            </button>
            {showHistory && (
              <ul className="mt-2 space-y-1.5">
                {c.history.map((h) => <HistoryRow key={h.id} h={h} />)}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function HistoryRow({ h }: { h: CommitmentHistoryRow }) {
  const label = FIELD_LABEL[h.field] ?? h.field;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">
      <span className="tabular-nums text-ink-subtle">{fmtWhen(h.changed_at)}</span>
      <span className="font-semibold text-ink">{label}</span>
      <span className="text-ink-subtle line-through">{h.old_value ?? "—"}</span>
      <span aria-hidden>→</span>
      <span className="font-medium text-heading">{h.new_value ?? "—"}</span>
      {h.changed_by_name && <span className="text-ink-subtle">· {h.changed_by_name}</span>}
    </li>
  );
}

// ── 4-week movement tracker ────────────────────────────────────────────────────
// Bars per fiscal week vs a baseline reference line and the target line, pulled
// live from the Ranker. Green when a week moves toward the target, red when it
// moves away. Weeks with no complete run yet render as a pending stub.
function MovementTracker({
  metric, baseline, target, series,
}: { metric: RankerMetric; baseline: number | null; target: number | null; series: MetricSeries }) {
  const weeks = series.weeks;
  const vals = weeks.map((w) => w.value).filter((v): v is number => v != null);
  const done = weeks.filter((w) => w.value != null);
  const latest = done.length ? done[done.length - 1].value! : null;

  const toward = (v: number | null): boolean | null => {
    if (v == null || baseline == null || target == null) return null;
    const need = target - baseline;
    if (Math.abs(need) < 1e-9) return Math.abs(v - baseline) < 1e-9;
    return Math.sign(v - baseline) === Math.sign(need);
  };
  const progress =
    latest != null && baseline != null && target != null && Math.abs(target - baseline) > 1e-9
      ? (latest - baseline) / (target - baseline)
      : null;

  // Shared vertical scale across bars + reference lines.
  const domain = [...vals, baseline, target].filter((v): v is number => v != null);
  const lo = domain.length ? Math.min(...domain) : 0;
  const hi = domain.length ? Math.max(...domain) : 1;
  const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.1 || 1;
  const min = lo - pad, max = hi + pad, span = max - min || 1;
  const pos = (v: number) => ((v - min) / span) * 100; // % from bottom

  return (
    <div className="mt-3 rounded-lg bg-surface-muted p-3 ring-1 ring-border">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
          <Activity className="h-3.5 w-3.5" /> 4-week movement
        </span>
        {progress != null && (
          <span className={cn("text-[11px] font-semibold tabular-nums", progress >= 1 ? "text-emerald-600" : progress > 0 ? "text-heading" : "text-red-600")}>
            {Math.round(progress * 100)}% to target
          </span>
        )}
      </div>
      <div className="relative flex h-20 items-end gap-2 border-b border-border pb-0">
        {/* baseline + target reference lines */}
        {baseline != null && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-subtle/60"
            style={{ bottom: `${pos(baseline)}%` }} aria-hidden />
        )}
        {target != null && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-accent"
            style={{ bottom: `${pos(target)}%` }} aria-hidden />
        )}
        {weeks.map((w, i) => {
          const t = toward(w.value);
          return (
            <div key={i} className="relative flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
              {w.value != null ? (
                <div
                  className={cn("w-full max-w-[2.25rem] rounded-t", t === false ? "bg-red-400/80" : t ? "bg-emerald-500/80" : "bg-ink-subtle/50")}
                  style={{ height: `${Math.max(4, pos(w.value))}%` }}
                  title={`W${w.week_in_period ?? i + 1}: ${fmtMetricValue(metric, w.value)}`}
                />
              ) : (
                <div className="w-full max-w-[2.25rem] rounded-t border border-dashed border-border" style={{ height: "8%" }} title="No data yet" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {weeks.map((w, i) => (
          <div key={i} className="flex-1 text-center">
            <div className="text-[10px] font-medium text-ink-subtle">W{w.week_in_period ?? i + 1}</div>
            <div className="text-[11px] font-semibold tabular-nums text-ink">{w.value != null ? fmtMetricValue(metric, w.value) : "—"}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-ink-subtle/60" /> Baseline {fmtMetricValue(metric, baseline)}</span>
        <span className="inline-flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-accent" /> Target {fmtMetricValue(metric, target) ?? "—"}</span>
      </div>
    </div>
  );
}

// ── Authoring modal ────────────────────────────────────────────────────────────
function CommitmentModal({
  draft, isNew, isLeader, rvps, period, saving, onChange, onOpenGuide, onClose, onSave,
}: {
  draft: Draft | null; isNew: boolean; isLeader: boolean; rvps: RvpOption[]; period: number;
  saving: boolean; onChange: (d: Draft) => void; onOpenGuide: () => void;
  onClose: () => void; onSave: () => void;
}) {
  const metric = draft?.metric_key ? METRICS_BY_KEY[draft.metric_key] ?? null : null;

  // Live 4-week baseline from the Ranker for the picked metric + RVP scope.
  const seriesQ = useQuery({
    queryKey: ["pc-metric-series", draft?.metric_key, period, draft?.rvp_user_id],
    queryFn: () => fetchMetricSeries(draft!.metric_key, period, draft!.rvp_user_id || undefined),
    enabled: draft != null && !!draft.metric_key && !!draft.rvp_user_id,
    staleTime: 60_000,
  });
  const liveBaseline = seriesQ.data?.baseline ?? null;

  // Auto-fill the baseline the first time it's blank for a freshly-picked metric;
  // never clobber a value the RVP has typed (the metric picker clears it on change).
  useEffect(() => {
    if (!draft || !draft.metric_key || liveBaseline == null) return;
    if (draft.baseline_value.trim() !== "") return;
    onChange({ ...draft, baseline_value: String(liveBaseline) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBaseline, draft?.metric_key]);
  const baseline = draft ? toNum(draft.baseline_value) : null;
  const target = draft ? toNum(draft.target_value) : null;
  const gap = gapInImpactUnit(metric, baseline, target);
  const gapLabel = fmtGap(metric, gap);
  const iUnit = impactUnit(metric);

  const [showActionHelp, setShowActionHelp] = useState(false);
  const actionSum = draft
    ? draft.actions.reduce((s, a) => s + (a.impact.trim() === "" ? 0 : Number(a.impact) || 0), 0)
    : 0;
  const covers = gap != null && Math.abs(actionSum) >= Math.abs(gap) - 1e-9 && Math.abs(gap) > 0;

  const setActions = (fn: (a: ActionDraft[]) => ActionDraft[]) =>
    draft && onChange({ ...draft, actions: fn(draft.actions) });

  return (
    <Modal
      open={draft != null}
      onClose={onClose}
      maxWidth="max-w-2xl"
      title={isNew ? "New commitment" : "Edit commitment"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !draft?.commitment_text.trim()} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {draft && (
        <div className="space-y-4">
          <button type="button" onClick={onOpenGuide}
            className="flex w-full items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-left text-xs text-heading ring-1 ring-border hover:ring-accent">
            <Info className="h-4 w-4 shrink-0 text-accent" />
            <span><span className="font-semibold">How to write one</span> — anchor to a metric, state the gap, and list specific actions. Read the playbook.</span>
          </button>

          {isNew && isLeader && (
            <div>
              <Label htmlFor="pc-rvp">RVP</Label>
              <select id="pc-rvp" value={draft.rvp_user_id}
                onChange={(e) => onChange({ ...draft, rvp_user_id: e.target.value })} className={inputCls}>
                <option value="">Select an RVP…</option>
                {rvps.map((r) => <option key={r.id} value={r.id}>{r.full_name ?? r.id}</option>)}
              </select>
            </div>
          )}

          {/* Anchor metric */}
          <div>
            <Label htmlFor="pc-metric">Ranker metric</Label>
            <select id="pc-metric" value={draft.metric_key}
              onChange={(e) => onChange({ ...draft, metric_key: e.target.value, baseline_value: "", target_value: "" })} className={inputCls}>
              <option value="">No metric — free-text commitment</option>
              {METRIC_GROUPS.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.metrics.map((m) => <option key={m.key} value={m.key}>{m.label} · goal {m.goal}</option>)}
                </optgroup>
              ))}
            </select>
            {metric && <p className="mt-1 text-[11px] text-ink-muted">Goal: {metric.goal}. The baseline auto-fills from your last 4 weeks on the Ranker; set where you'll take it.</p>}
          </div>

          {/* Baseline → target */}
          {metric && (
            <div className="rounded-lg bg-surface-muted p-3 ring-1 ring-border">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="pc-baseline">4-week baseline{metric.unit ? ` (${metric.unit})` : ""}</Label>
                  <Input id="pc-baseline" type="number" step="any" value={draft.baseline_value}
                    onChange={(e) => onChange({ ...draft, baseline_value: e.target.value })} placeholder="e.g. 96.1" />
                </div>
                <div>
                  <Label htmlFor="pc-target">Target{metric.unit ? ` (${metric.unit})` : ""}</Label>
                  <Input id="pc-target" type="number" step="any" value={draft.target_value}
                    onChange={(e) => onChange({ ...draft, target_value: e.target.value })} placeholder="e.g. 97.0" />
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <Sparkles className="h-3 w-3 text-accent" />
                {!draft.rvp_user_id ? (
                  <span className="text-ink-muted">Select an RVP above to auto-pull their last-4-week baseline.</span>
                ) : seriesQ.isFetching ? (
                  <span className="text-ink-muted">Pulling the last 4 weeks from the Ranker…</span>
                ) : liveBaseline != null ? (
                  <span className="text-ink-muted">
                    Last-4-week Ranker baseline <span className="font-semibold text-heading">{fmtMetricValue(metric, liveBaseline)}</span>
                    {String(liveBaseline) !== draft.baseline_value.trim() && (
                      <button type="button" onClick={() => onChange({ ...draft, baseline_value: String(liveBaseline) })}
                        className="ml-1.5 font-semibold text-accent hover:text-accent-hover">Apply</button>
                    )}
                  </span>
                ) : (
                  <span className="text-ink-muted">No matching Ranker data for this RVP yet — enter the baseline manually.</span>
                )}
              </div>
              {gapLabel && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                  <span>The gap to close:</span>
                  <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
                    gap! >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
                    {gap! >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {gapLabel}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Objective */}
          <div>
            <Label htmlFor="pc-text">Objective *</Label>
            <textarea id="pc-text" rows={2} value={draft.commitment_text}
              onChange={(e) => onChange({ ...draft, commitment_text: e.target.value })}
              className={inputCls}
              placeholder={metric ? `Move ${metric.label} from baseline to target by end of period.` : "What are you committing to this period?"} />
          </div>

          {/* Specific actions */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Label className="mb-0">Specific actions</Label>
                <button type="button" onClick={() => setShowActionHelp((v) => !v)}
                  aria-label="What makes a good action" title="What makes a good action"
                  className={cn("rounded p-0.5 hover:text-accent", showActionHelp ? "text-accent" : "text-ink-subtle")}>
                  <Info className="h-3.5 w-3.5" />
                </button>
              </div>
              {metric && gap != null && (
                <span className={cn("text-[11px] font-semibold tabular-nums",
                  covers ? "text-emerald-600" : "text-warning")}>
                  Actions {actionSum > 0 ? "+" : ""}{actionSum} {iUnit} {covers ? "≥" : "<"} gap {fmtGap(metric, gap)}
                </span>
              )}
            </div>
            {showActionHelp && (
              <div className="mb-2 rounded-lg bg-canvas p-3 text-[11px] leading-relaxed text-ink-muted ring-1 ring-border">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Example action</div>
                <div className="rounded-md bg-surface p-2 ring-1 ring-border">
                  <div className="text-ink">Retrain 3 openers on portioning discipline</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-muted">
                    <span><span className="text-ink-subtle">Owner</span> GM</span>
                    <span><span className="text-ink-subtle">Cadence</span> Daily pre-shift</span>
                    <span className="font-semibold text-heading">+50 {iUnit || "bps"}</span>
                  </div>
                </div>
                <ul className="mt-2 space-y-1">
                  <li><span className="font-semibold text-heading">What</span> — the concrete, observable action. Not "improve labor"; name exactly what changes.</li>
                  <li><span className="font-semibold text-heading">Owner</span> — the one person or role accountable for it.</li>
                  <li><span className="font-semibold text-heading">Cadence</span> — how often it happens: daily, weekly, each pre-shift.</li>
                  <li><span className="font-semibold text-heading">Impact</span> — expected effect on the metric{iUnit ? ` (${iUnit})` : ""}. The actions should sum to at least the gap.</li>
                </ul>
              </div>
            )}
            <div className="space-y-2">
              {draft.actions.map((a, i) => (
                <div key={i} className="rounded-lg bg-surface-muted p-2.5 ring-1 ring-border">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas text-[11px] font-bold text-heading">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <input value={a.what} placeholder="What specifically will be done? (e.g. Retrain 3 openers on waste-log discipline)"
                        onChange={(e) => setActions((as) => as.map((x, j) => j === i ? { ...x, what: e.target.value } : x))}
                        className={inputCls} />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input value={a.owner} placeholder="Owner (who)"
                          onChange={(e) => setActions((as) => as.map((x, j) => j === i ? { ...x, owner: e.target.value } : x))}
                          className={inputCls} />
                        <input value={a.cadence} placeholder="Cadence (how often)"
                          onChange={(e) => setActions((as) => as.map((x, j) => j === i ? { ...x, cadence: e.target.value } : x))}
                          className={inputCls} />
                        <input value={a.impact} type="number" step="any" placeholder={`Impact${iUnit ? ` (${iUnit})` : ""}`}
                          onChange={(e) => setActions((as) => as.map((x, j) => j === i ? { ...x, impact: e.target.value } : x))}
                          className={inputCls} />
                      </div>
                    </div>
                    <button type="button" aria-label="Remove action"
                      onClick={() => setActions((as) => as.length > 1 ? as.filter((_, j) => j !== i) : [emptyAction()])}
                      className="mt-1.5 rounded-md p-1 text-ink-subtle hover:bg-surface-sunk hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setActions((as) => [...as, emptyAction()])}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
              <Plus className="h-3.5 w-3.5" /> Add action
            </button>
          </div>

          {/* Status */}
          <div>
            <Label htmlFor="pc-status">Status</Label>
            <select id="pc-status" value={draft.status}
              onChange={(e) => onChange({ ...draft, status: e.target.value as CommitmentStatus })} className={inputCls}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Guidance ("how to write one") ──────────────────────────────────────────────
const PRINCIPLES: { n: number; title: string; body: string }[] = [
  { n: 1, title: "Anchor to a metric", body: "Start from a number on the Ranker, not a feeling. A commitment the Ranker can't score isn't a commitment — it's a wish." },
  { n: 2, title: "State the gap and the date", body: "Baseline → target, and by when. \"96.1% → 97.0% by period close\" is a gap you can be held to; \"improve COGS\" is not." },
  { n: 3, title: "Decompose the driver (MECE)", body: "Break the gap into the few levers that actually move it — no overlaps, no gaps. Most metrics move on 2–4 drivers, not twenty." },
  { n: 4, title: "Commit to controllable inputs", body: "Own the inputs you control, not the output you hope for. \"Waste log audited daily\" is an input; \"lower food cost\" is an output." },
  { n: 5, title: "Make each action specific", body: "What, who, and cadence — every action names all three. \"Retrain 3 openers on portioning, GM-led, daily pre-shift\" is an action. \"Improve efficiency\" is a slogan." },
  { n: 6, title: "Prove the math adds up", body: "The actions' expected impact should sum to at least the gap. If the gap is +90 bps and your actions total +40, the plan is short — add levers or reset the target." },
];
const CONTRAST: { generic: string; specific: string }[] = [
  { generic: "Improve labor", specific: "Cut overtime to zero on Fri–Sun by GM-built schedules posted Wednesday; DO audits weekly. −60 bps." },
  { generic: "Improve efficiency", specific: "Deploy the drive-in position on the 11a–1p peak, 7 days; SDO spot-checks twice weekly. +0.4 On-Time pts." },
  { generic: "Lower food cost", specific: "Daily waste log signed by MOD; weekly COGS review with the 2 worst stores. +50 bps COGS efficiency." },
];

function GuidanceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl" title="How to write a commitment worth reading"
      footer={<Button onClick={onClose}>Got it</Button>}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          A commitment is a number, a gap, and the specific inputs you'll control to close it. Six principles.
        </p>
        <ol className="space-y-2.5">
          {PRINCIPLES.map((p) => (
            <li key={p.n} className="flex gap-3 rounded-lg bg-surface-muted p-3 ring-1 ring-border">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">{p.n}</span>
              <div>
                <div className="text-sm font-semibold text-heading">{p.title}</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{p.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Generic vs. specific</div>
          <div className="overflow-hidden rounded-lg ring-1 ring-border">
            {CONTRAST.map((c, i) => (
              <div key={i} className={cn("grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_1.6fr]", i > 0 && "border-t border-border")}>
                <div className="flex items-start gap-1.5 text-[13px] text-red-700">
                  <span className="mt-0.5 text-red-400">✕</span> <span className="line-through decoration-red-300">{c.generic}</span>
                </div>
                <div className="flex items-start gap-1.5 text-[13px] text-ink">
                  <span className="mt-0.5 font-bold text-emerald-600">✓</span> <span>{c.specific}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
