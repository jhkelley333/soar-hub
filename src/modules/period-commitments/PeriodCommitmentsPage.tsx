// RVP Period Commitments (Phase 6) — each RVP records what they're committing to
// this fiscal period, with a target and status. Targets/text/status are editable
// inline; every edit is recorded in an immutable history the DB writes by trigger
// and this page shows inline per commitment. Leadership (VP/COO/admin) sees and
// edits every RVP's commitments and can file one on an RVP's behalf.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, History, Pencil, Plus, Target } from "lucide-react";
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
  fetchPeriodCommitments, createPeriodCommitment, updatePeriodCommitment,
  type PeriodCommitment, type CommitmentStatus, type CommitmentHistoryRow, type RvpOption,
} from "./api";

const STATUS_STYLE: Record<CommitmentStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  met: { label: "Met", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  missed: { label: "Missed", cls: "bg-red-50 text-red-700 ring-red-200" },
};
const STATUSES: CommitmentStatus[] = ["active", "met", "missed"];

const fmtTarget = (v: number | null, unit: string | null) =>
  v == null ? null : `${v}${unit ? (unit === "%" || unit === "h" ? unit : ` ${unit}`) : ""}`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const FIELD_LABEL: Record<string, string> = {
  commitment_text: "Commitment", target_value: "Target", target_unit: "Unit", status: "Status",
};

type Draft = {
  id?: string;
  rvp_user_id: string;
  commitment_text: string;
  target_value: string;
  target_unit: string;
  status: CommitmentStatus;
};

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
  const isNew = editing != null && !editing.id;
  const rvps = q.data?.rvps ?? [];
  const isLeader = q.data?.scope === "all";
  const selfId = q.data?.self_id ?? "";

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const tv = d.target_value.trim() === "" ? null : Number(d.target_value);
      if (d.id) {
        return updatePeriodCommitment({
          id: d.id, commitment_text: d.commitment_text, target_value: tv,
          target_unit: d.target_unit.trim() || null, status: d.status,
        });
      }
      return createPeriodCommitment({
        fiscal_year: fiscalYear, period, commitment_text: d.commitment_text,
        target_value: tv, target_unit: d.target_unit.trim() || null, status: d.status,
        rvp_user_id: d.rvp_user_id || undefined,
      });
    },
    onSuccess: () => { toast.push("Saved.", "success"); invalidate(); setEditing(null); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  const openNew = () => setEditing({ rvp_user_id: selfId, commitment_text: "", target_value: "", target_unit: "", status: "active" });
  const openEdit = (c: PeriodCommitment) => setEditing({
    id: c.id, rvp_user_id: c.rvp_user_id, commitment_text: c.commitment_text,
    target_value: c.target_value == null ? "" : String(c.target_value),
    target_unit: c.target_unit ?? "", status: c.status,
  });

  const stepPeriod = (delta: number) => setPeriod((p) => Math.min(12, Math.max(1, p + delta)));

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title="Period Commitments"
        description="What each RVP is committing to this fiscal period — with a target, a status, and a full edit history."
        actions={<Button size="sm" onClick={openNew} disabled={q.isLoading}><Plus className="mr-1 h-3.5 w-3.5" /> New commitment</Button>}
      />

      {/* Period selector */}
      <div className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 ring-1 ring-zinc-200">
        <button onClick={() => stepPeriod(-1)} disabled={period <= 1}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-midnight">{fiscalYear} · Period {period}</div>
          {period === currentPeriod && <div className="text-[11px] font-medium uppercase tracking-wide text-accent-600">Current period</div>}
        </div>
        <button onClick={() => stepPeriod(1)} disabled={period >= 12}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" aria-label="Next period">
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
        draft={editing} isNew={isNew} isLeader={isLeader} rvps={rvps}
        saving={save.isPending}
        onChange={setEditing}
        onClose={() => setEditing(null)}
        onSave={() => editing && save.mutate(editing)}
      />
    </div>
  );
}

function CommitmentCard({ c, showRvp, onEdit }: { c: PeriodCommitment; showRvp: boolean; onEdit: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const st = STATUS_STYLE[c.status];
  const target = fmtTarget(c.target_value, c.target_unit);
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {showRvp && <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">{c.rvp_name ?? "Unassigned RVP"}</div>}
            <p className="text-sm leading-relaxed text-midnight">{c.commitment_text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1", st.cls)}>{st.label}</span>
              {target && (
                <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
                  <Target className="h-3 w-3" /> {target}
                </span>
              )}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onEdit} className="shrink-0"><Pencil className="h-3.5 w-3.5" /></Button>
        </div>

        {c.history.length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-2">
            <button onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-accent-700">
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
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
      <span className="tabular-nums text-zinc-400">{fmtWhen(h.changed_at)}</span>
      <span className="font-semibold text-zinc-600">{label}</span>
      <span className="text-zinc-400 line-through">{h.old_value ?? "—"}</span>
      <span aria-hidden>→</span>
      <span className="font-medium text-midnight">{h.new_value ?? "—"}</span>
      {h.changed_by_name && <span className="text-zinc-400">· {h.changed_by_name}</span>}
    </li>
  );
}

function CommitmentModal({
  draft, isNew, isLeader, rvps, saving, onChange, onClose, onSave,
}: {
  draft: Draft | null; isNew: boolean; isLeader: boolean; rvps: RvpOption[];
  saving: boolean; onChange: (d: Draft) => void; onClose: () => void; onSave: () => void;
}) {
  return (
    <Modal
      open={draft != null}
      onClose={onClose}
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
        <div className="space-y-3">
          {isNew && isLeader && (
            <div>
              <Label htmlFor="pc-rvp">RVP</Label>
              <select id="pc-rvp" value={draft.rvp_user_id}
                onChange={(e) => onChange({ ...draft, rvp_user_id: e.target.value })}
                className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent">
                <option value="">Select an RVP…</option>
                {rvps.map((r) => <option key={r.id} value={r.id}>{r.full_name ?? r.id}</option>)}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="pc-text">Commitment *</Label>
            <textarea id="pc-text" rows={3} value={draft.commitment_text}
              onChange={(e) => onChange({ ...draft, commitment_text: e.target.value })}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="What are you committing to this period?" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pc-target">Target value</Label>
              <Input id="pc-target" type="number" step="any" value={draft.target_value}
                onChange={(e) => onChange({ ...draft, target_value: e.target.value })} placeholder="e.g. 95" />
            </div>
            <div>
              <Label htmlFor="pc-unit">Unit</Label>
              <Input id="pc-unit" value={draft.target_unit}
                onChange={(e) => onChange({ ...draft, target_unit: e.target.value })} placeholder="% · h · $ · pts" />
            </div>
          </div>
          <div>
            <Label htmlFor="pc-status">Status</Label>
            <select id="pc-status" value={draft.status}
              onChange={(e) => onChange({ ...draft, status: e.target.value as CommitmentStatus })}
              className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent">
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_STYLE[s].label}</option>)}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}
