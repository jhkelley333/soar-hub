// GM support-hours credit (SDO+). Some stores have a GM who supports other
// stores and gets a set number of labor hours credited each week (default 20).
// Tag the store here; the credit converts those hours to dollars using the
// store's own blended wage and applies to its Labor v2 chart each day the tag
// is active. Mirrors the No-GM credit panel.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  addGmSupportCredit, deleteGmSupportCredit, endGmSupportCredit, fetchLaborV2Stores,
  fetchGmSupportCredits, updateGmSupportCredit, type GmSupportCreditRow,
} from "./api";

const fmtDate = (s: string | null) =>
  s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const todayIso = () => new Date().toLocaleDateString("en-CA");
const inputCls = "rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none";

export function GmSupportCreditPanel() {
  const toast = useToast();
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["gm-support-credits"], queryFn: fetchGmSupportCredits });
  const storesQ = useQuery({ queryKey: ["labor-v2-stores"], queryFn: fetchLaborV2Stores });
  const stores = storesQ.data?.stores ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = adding
  const [store, setStore] = useState("");
  const [basis, setBasis] = useState<"hours" | "buffer">("hours");
  const [hours, setHours] = useState("20");
  const [buffer, setBuffer] = useState("2");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [endTarget, setEndTarget] = useState<GmSupportCreditRow | null>(null);
  const [endOn, setEndOn] = useState(todayIso());
  const [search, setSearch] = useState("");

  const openAdd = () => {
    setEditId(null); setStore(""); setBasis("hours"); setHours("20"); setBuffer("2");
    setStartDate(todayIso()); setEndDate(""); setNote("");
    setFormOpen(true);
  };
  const openEdit = (r: GmSupportCreditRow) => {
    setEditId(r.id); setStore(r.store_number);
    if (r.buffer_pct != null) { setBasis("buffer"); setBuffer(String(r.buffer_pct)); setHours("20"); }
    else { setBasis("hours"); setHours(String(r.weekly_hours ?? 20)); setBuffer("2"); }
    setStartDate(r.start_date); setEndDate(r.end_date ?? ""); setNote(r.note ?? "");
    setFormOpen(true);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["gm-support-credits"] });
    qc.invalidateQueries({ predicate: (query) => String(query.queryKey[0] ?? "").startsWith("labor") });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        basis, start_date: startDate,
        end_date: endDate || (editId ? null : undefined), note: note.trim() || undefined,
        ...(basis === "buffer" ? { buffer_pct: Number(buffer) } : { weekly_hours: Number(hours) }),
      } as const;
      return editId
        ? updateGmSupportCredit(editId, payload)
        : addGmSupportCredit({ store_number: store, ...payload });
    },
    onSuccess: () => {
      toast.push(editId ? "Tag updated." : "Store tagged — the credit applies from the start date.", "success");
      setFormOpen(false);
      invalidate();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });
  const end = useMutation({
    mutationFn: () => endGmSupportCredit(endTarget!.id, endOn),
    onSuccess: () => { toast.push("Ended — credit stops after that date.", "success"); setEndTarget(null); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't end.", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteGmSupportCredit(id),
    onSuccess: () => { toast.push("Deleted.", "success"); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't delete.", "error"),
  });

  const rows = q.data?.rows ?? [];
  const matchesSearch = (r: GmSupportCreditRow) => {
    const s = search.trim().toLowerCase();
    return !s || `${r.store_number} ${r.store_name ?? ""}`.toLowerCase().includes(s);
  };
  const byStore = (a: GmSupportCreditRow, b: GmSupportCreditRow) =>
    String(a.store_number).localeCompare(String(b.store_number), undefined, { numeric: true });
  const activeRows = useMemo(() => rows.filter((r) => r.active && matchesSearch(r)).sort(byStore), [rows, search]);
  const pastRows = useMemo(() => rows.filter((r) => !r.active && matchesSearch(r)).sort(byStore), [rows, search]);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (q.isError) return <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-zinc-200">
        <div>
          <div className="text-sm font-semibold text-midnight">GM support-hours credit</div>
          <div className="text-xs text-zinc-500">
            For a GM who supports other stores. Credit the tagged store either a set{" "}
            <strong className="text-midnight">hours/week</strong> (at its blended wage) or a{" "}
            <strong className="text-midnight">% buffer off labor</strong> — for as long as the tag is active.
          </div>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Tag a store
        </Button>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by store # or name…" className={cn(inputCls, "w-full max-w-sm")} />

      <Section title={`Active (${activeRows.length})`}>
        {activeRows.length === 0
          ? <p className="p-4 text-sm text-zinc-500">{search ? "No active tags match that search." : "No stores are tagged right now."}</p>
          : activeRows.map((r) => (
            <Row key={r.id} r={r}
              onEdit={() => openEdit(r)}
              onEnd={() => { setEndTarget(r); setEndOn(todayIso()); }}
              onDelete={() => { if (window.confirm(`Delete the support-hours tag for #${r.store_number}? The credit is removed for its whole date range.`)) remove.mutate(r.id); }} />
          ))}
      </Section>

      {pastRows.length > 0 && (
        <Section title={`Ended / upcoming (${pastRows.length})`}>
          {pastRows.map((r) => (
            <Row key={r.id} r={r}
              onEdit={() => openEdit(r)}
              onDelete={() => { if (window.confirm(`Delete the support-hours tag for #${r.store_number}? The credit is removed for its whole date range.`)) remove.mutate(r.id); }} />
          ))}
        </Section>
      )}

      {/* Add / edit modal */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)}
        title={editId ? "Edit tag — GM support hours" : "Tag a store — GM support hours"}
        footer={
          <Button size="sm" onClick={() => save.mutate()}
            disabled={!store || !startDate || save.isPending || (basis === "buffer" ? !(Number(buffer) > 0) : !(Number(hours) > 0))}>
            {save.isPending ? "Saving…" : editId ? "Save changes" : "Start credit"}
          </Button>
        }>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Store</label>
            <select value={store} onChange={(e) => setStore(e.target.value)} disabled={!!editId}
              className={cn(inputCls, "w-full", editId && "cursor-not-allowed bg-zinc-50 text-zinc-500")}>
              <option value="">Pick a store…</option>
              {stores.map((s) => <option key={s.id} value={s.number}>#{s.number} · {s.name}</option>)}
            </select>
            {editId && <p className="mt-1 text-[11px] text-zinc-400">Store can't be changed — delete and re-tag to move it.</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Credit basis</label>
            <div className="flex gap-2">
              {(["hours", "buffer"] as const).map((b) => (
                <button key={b} type="button" onClick={() => setBasis(b)}
                  className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition",
                    basis === b ? "border-accent bg-accent-50 text-accent-700" : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50")}>
                  {b === "hours" ? "Weekly hours" : "% buffer"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              {basis === "buffer" ? (
                <>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600">Buffer % off labor</label>
                  <input type="number" min={0.1} max={100} step="0.1" value={buffer} onChange={(e) => setBuffer(e.target.value)} className={cn(inputCls, "w-full")} />
                </>
              ) : (
                <>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600">Hours / week</label>
                  <input type="number" min={1} max={80} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className={cn(inputCls, "w-full")} />
                </>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-600">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={cn(inputCls, "w-full")} />
            </div>
          </div>
          <p className="text-[11px] text-zinc-400">
            {basis === "buffer"
              ? "Reduces the store's labor (cost + hours) by this percent each day the tag is active, sized from its recent labor."
              : "Credits this many hours/week, converted to dollars at the store's own blended wage."}
          </p>
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">End date (optional)</label>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={cn(inputCls, "w-full")} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-600">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder="e.g. GM covers #1234 and #5678 twice a week" className={cn(inputCls, "w-full")} />
          </div>
          <p className="text-xs text-zinc-500">
            Leave the end date blank while the arrangement stands — the credit keeps applying until you end the tag.
          </p>
        </div>
      </Modal>

      {/* End modal */}
      <Modal open={endTarget != null} onClose={() => setEndTarget(null)}
        title={endTarget ? `End tag — #${endTarget.store_number}` : ""}
        footer={<Button size="sm" onClick={() => end.mutate()} disabled={!endOn || end.isPending}>{end.isPending ? "Saving…" : "End credit"}</Button>}>
        <p className="mb-3 text-xs text-zinc-500">Last day the credit applies.</p>
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

function Row({ r, onEdit, onEnd, onDelete }: { r: GmSupportCreditRow; onEdit: () => void; onEnd?: () => void; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-midnight">#{r.store_number}{r.store_name ? ` · ${r.store_name}` : ""}</span>
          <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-700">
            {r.buffer_pct != null ? `${r.buffer_pct}% buffer` : `${r.weekly_hours} hrs/wk`}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          {fmtDate(r.start_date)} → {r.end_date ? fmtDate(r.end_date) : "open"}
          {r.created_by_email ? ` · by ${r.created_by_email}` : ""}
          {r.note ? ` · ${r.note}` : ""}
        </div>
      </div>
      {onEnd && r.active && !r.end_date && <Button size="sm" variant="secondary" onClick={onEnd}>End</Button>}
      <button onClick={onEdit} title="Edit tag" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-50 hover:text-accent-700">
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={onDelete} title="Delete tag" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-50 hover:text-red-600">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
