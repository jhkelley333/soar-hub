// No-GM labor credit tab (SDO and above). A store without a GM gets a weekly
// labor credit (default $880, admin-adjustable) applied to its Labor v2 chart
// for as long as the tag is active. Three reasons: LOA / No GM / In Training.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import {
  addNoGmCredit, deleteNoGmCredit, endNoGmCredit, fetchLaborV2Stores,
  fetchNoGmCredits, setNoGmWeeklyRate, type NoGmCreditRow,
} from "./api";

const REASONS: { key: string; label: string }[] = [
  { key: "loa", label: "LOA" },
  { key: "no_gm", label: "No GM" },
  { key: "in_training", label: "In Training" },
];
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.key, r.label]));
const REASON_TONE: Record<string, string> = {
  loa: "bg-amber-50 text-amber-700",
  no_gm: "bg-sonic-50 text-sonic-700",
  in_training: "bg-accent-100 text-accent-700",
};

const fmtUSD = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const todayIso = () => new Date().toLocaleDateString("en-CA");

const inputCls =
  "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";

export function NoGmCreditPanel() {
  const { profile } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const isAdmin = profile?.role === "admin";

  const q = useQuery({ queryKey: ["no-gm-credits"], queryFn: fetchNoGmCredits });
  const storesQ = useQuery({ queryKey: ["labor-v2-stores"], queryFn: fetchLaborV2Stores });
  const stores = storesQ.data?.stores ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [store, setStore] = useState("");
  const [reason, setReason] = useState("no_gm");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [endTarget, setEndTarget] = useState<NoGmCreditRow | null>(null);
  const [endOn, setEndOn] = useState(todayIso());
  const [rateDraft, setRateDraft] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["no-gm-credits"] });
    // Credits change the labor math everywhere.
    qc.invalidateQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("labor") });
  };

  const add = useMutation({
    mutationFn: () => addNoGmCredit({
      store_number: store, reason, start_date: startDate,
      end_date: endDate || undefined, note: note.trim() || undefined,
    }),
    onSuccess: () => {
      toast.push("Store tagged — credit applies from the start date.", "success");
      setAddOpen(false); setStore(""); setReason("no_gm"); setStartDate(todayIso()); setEndDate(""); setNote("");
      invalidate();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  const end = useMutation({
    mutationFn: () => endNoGmCredit(endTarget!.id, endOn),
    onSuccess: () => { toast.push("Ended — credit stops after that date.", "success"); setEndTarget(null); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't end.", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteNoGmCredit(id),
    onSuccess: () => { toast.push("Deleted.", "success"); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't delete.", "error"),
  });

  const saveRate = useMutation({
    mutationFn: (amount: number) => setNoGmWeeklyRate(amount),
    onSuccess: (r) => { toast.push(`Weekly credit set to ${fmtUSD(r.amount)}.`, "success"); setRateDraft(null); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save rate.", "error"),
  });

  const rows = q.data?.rows ?? [];
  const weekly = q.data?.weekly ?? 880;
  const activeRows = rows.filter((r) => r.active);
  const pastRows = rows.filter((r) => !r.active);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;

  return (
    <div className="space-y-5">
      {/* Rate + add */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-zinc-200">
        <div>
          <div className="text-sm font-semibold text-midnight">No-GM labor credit</div>
          <div className="text-xs text-zinc-500">
            Stores without a GM are credited{" "}
            <strong className="text-midnight">{fmtUSD(weekly)}/week</strong> ({fmtUSD(weekly / 7)}/day) on their labor
            chart while the tag is active.
            {isAdmin && rateDraft == null && (
              <button className="ml-2 font-semibold text-accent hover:underline" onClick={() => setRateDraft(String(weekly))}>
                Change rate
              </button>
            )}
          </div>
          {isAdmin && rateDraft != null && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" min={1} step="0.01" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)}
                className={cn(inputCls, "w-32")} />
              <Button size="sm" onClick={() => saveRate.mutate(Number(rateDraft))} disabled={saveRate.isPending || !(Number(rateDraft) > 0)}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRateDraft(null)}>Cancel</Button>
            </div>
          )}
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Tag a store
        </Button>
      </div>

      {/* Active tags */}
      <Section title={`Active (${activeRows.length})`}>
        {activeRows.length === 0
          ? <p className="p-4 text-sm text-zinc-500">No stores are tagged right now.</p>
          : activeRows.map((r) => (
              <Row key={r.id} r={r}
                onEnd={() => { setEndTarget(r); setEndOn(todayIso()); }}
                onDelete={() => { if (window.confirm(`Delete the ${REASON_LABEL[r.reason]} tag for #${r.store_number}? The credit is removed for its whole date range.`)) remove.mutate(r.id); }} />
            ))}
      </Section>

      {/* History */}
      {pastRows.length > 0 && (
        <Section title={`Ended / upcoming (${pastRows.length})`}>
          {pastRows.map((r) => (
            <Row key={r.id} r={r}
              onDelete={() => { if (window.confirm(`Delete the ${REASON_LABEL[r.reason]} tag for #${r.store_number}? The credit is removed for its whole date range.`)) remove.mutate(r.id); }} />
          ))}
        </Section>
      )}

      {/* Add modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Tag a store — no GM"
        footer={
          <Button size="sm" onClick={() => add.mutate()} disabled={!store || !startDate || add.isPending}>
            {add.isPending ? "Saving…" : "Start credit"}
          </Button>
        }>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Store</label>
            <select value={store} onChange={(e) => setStore(e.target.value)} className={cn(inputCls, "w-full")}>
              <option value="">Pick a store…</option>
              {stores.map((s) => <option key={s.id} value={s.number}>#{s.number} · {s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Reason</label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r.key} type="button" onClick={() => setReason(r.key)}
                  className={cn("rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    reason === r.key ? "bg-midnight text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-600">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={cn(inputCls, "w-full")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-600">End date (optional)</label>
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={cn(inputCls, "w-full")} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder="e.g. GM resigned 7/3 — posting open" className={cn(inputCls, "w-full")} />
          </div>
          <p className="text-xs text-zinc-500">
            Leave the end date blank while the seat is open — the credit keeps applying until you end the tag.
          </p>
        </div>
      </Modal>

      {/* End modal */}
      <Modal open={endTarget != null} onClose={() => setEndTarget(null)}
        title={endTarget ? `End tag — #${endTarget.store_number}` : ""}
        footer={
          <Button size="sm" onClick={() => end.mutate()} disabled={!endOn || end.isPending}>
            {end.isPending ? "Saving…" : "End credit"}
          </Button>
        }>
        <p className="mb-3 text-xs text-zinc-500">
          Last day the credit applies. Use the day before the new GM's first day.
        </p>
        <input type="date" value={endOn} min={endTarget?.start_date} onChange={(e) => setEndOn(e.target.value)} className={cn(inputCls, "w-full")} />
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
      <div className="border-b border-zinc-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="divide-y divide-zinc-100">{children}</div>
    </div>
  );
}

function Row({ r, onEnd, onDelete }: { r: NoGmCreditRow; onEnd?: () => void; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-midnight">#{r.store_number}{r.store_name ? ` · ${r.store_name}` : ""}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", REASON_TONE[r.reason] ?? "bg-zinc-100 text-zinc-600")}>
            {REASON_LABEL[r.reason] ?? r.reason}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {fmtDate(r.start_date)} → {r.end_date ? fmtDate(r.end_date) : "open"}
          {r.created_by_email ? ` · by ${r.created_by_email}` : ""}
          {r.note ? ` · ${r.note}` : ""}
        </div>
      </div>
      {onEnd && r.active && !r.end_date && (
        <Button size="sm" variant="secondary" onClick={onEnd}>End</Button>
      )}
      <button onClick={onDelete} title="Delete tag" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-50 hover:text-red-600">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
