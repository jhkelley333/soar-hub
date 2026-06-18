// SOAR QSR — above-store Manager dashboard (Milestone 5). Real server-side
// rollups: org KPIs, completion by course and by store (grouped by region),
// course assignments, and an audit CSV export. Admin-only (route-gated).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BarChart3, Download, Loader2, Plus, Trash2, Users } from "lucide-react";
import { useToast } from "@/shared/ui/Toaster";
import {
  fetchManageOverview, fetchByCourse, fetchByStore, fetchAssignTargets,
  fetchAssignments, createAssignment, deleteAssignment, fetchCompletions,
  type Assignment,
} from "../api";

const card = "rounded-2xl border border-border bg-surface p-5";
const inputCls = "block w-full rounded-lg border border-border bg-surface px-3 py-2 font-qsr-ui text-sm text-ink focus:border-qsr-azure focus:outline-none focus:ring-1 focus:ring-qsr-azure";

function RateBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunk">
        <div className="h-full rounded-full bg-qsr-azure" style={{ width: `${rate}%` }} />
      </div>
      <span className="font-qsr-mono text-xs text-ink-muted">{rate}%</span>
    </div>
  );
}

function exportCsv(rows: Record<string, string>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function ManagerDashboardPage() {
  const toast = useToast();
  const overviewQ = useQuery({ queryKey: ["qsr", "manage", "overview"], queryFn: fetchManageOverview });
  const byCourseQ = useQuery({ queryKey: ["qsr", "manage", "byCourse"], queryFn: fetchByCourse });
  const byStoreQ = useQuery({ queryKey: ["qsr", "manage", "byStore"], queryFn: fetchByStore });

  const exportM = useMutation({
    mutationFn: fetchCompletions,
    onSuccess: (r) => {
      if (!r.rows.length) { toast.push("No completions to export yet.", "error"); return; }
      exportCsv(r.rows as unknown as Record<string, string>[], `qsr-completions-${new Date().toISOString().slice(0, 10)}.csv`);
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Export failed.", "error"),
  });

  const o = overviewQ.data;
  const kpis = [
    { label: "Active learners", value: o?.learners, icon: Users },
    { label: "Published courses", value: o?.publishedCourses },
    { label: "Completion rate", value: o == null ? undefined : `${o.completionRate}%` },
    { label: "Points earned", value: o?.totalPoints },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/qsr" className="inline-flex items-center gap-1.5 font-qsr-ui text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> SOAR QSR
        </Link>
        <button type="button" onClick={() => exportM.mutate()} disabled={exportM.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-qsr-ui text-sm font-semibold text-ink hover:border-qsr-azure disabled:opacity-40">
          {exportM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export completions
        </button>
      </div>

      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-qsr-azure" />
        <h1 className="font-qsr-display text-2xl font-bold text-ink">Manager dashboard</h1>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={card}>
            <div className="font-qsr-ui text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{k.label}</div>
            <div className="mt-1 font-qsr-display text-2xl font-bold text-ink">
              {k.value == null ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-surface-sunk" /> : k.value}
            </div>
          </div>
        ))}
      </div>

      {/* By course */}
      <div className={card}>
        <h2 className="mb-3 font-qsr-display text-lg font-semibold text-ink">Completion by course</h2>
        {byCourseQ.isLoading ? <div className="h-16 animate-pulse rounded-xl bg-surface-sunk" /> : (
          <table className="w-full text-left">
            <thead>
              <tr className="font-qsr-ui text-[11px] uppercase tracking-wide text-ink-subtle">
                <th className="pb-2">Course</th><th className="pb-2">Status</th><th className="pb-2">Enrolled</th><th className="pb-2">Completed</th><th className="pb-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {(byCourseQ.data?.courses ?? []).map((c) => (
                <tr key={c.id} className="border-t border-border font-qsr-ui text-sm text-ink">
                  <td className="py-2 pr-2">{c.title}</td>
                  <td className="py-2 pr-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${c.status === "published" ? "bg-qsr-azure/10 text-qsr-azure" : "bg-surface-sunk text-ink-subtle"}`}>{c.status}</span></td>
                  <td className="py-2 pr-2 font-qsr-mono">{c.enrolled}</td>
                  <td className="py-2 pr-2 font-qsr-mono">{c.completed}</td>
                  <td className="py-2"><RateBar rate={c.rate} /></td>
                </tr>
              ))}
              {(byCourseQ.data?.courses ?? []).length === 0 && <tr><td colSpan={5} className="py-3 font-qsr-ui text-sm text-ink-muted">No enrollments yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {/* By store (region-grouped) */}
      <div className={card}>
        <h2 className="mb-3 font-qsr-display text-lg font-semibold text-ink">Completion by store</h2>
        {byStoreQ.isLoading ? <div className="h-16 animate-pulse rounded-xl bg-surface-sunk" /> : (
          <table className="w-full text-left">
            <thead>
              <tr className="font-qsr-ui text-[11px] uppercase tracking-wide text-ink-subtle">
                <th className="pb-2">Store</th><th className="pb-2">Region</th><th className="pb-2">Learners</th><th className="pb-2">Completed</th><th className="pb-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {(byStoreQ.data?.stores ?? []).map((s) => (
                <tr key={s.store_id} className="border-t border-border font-qsr-ui text-sm text-ink">
                  <td className="py-2 pr-2">{s.number} — {s.name}</td>
                  <td className="py-2 pr-2 text-ink-muted">{s.region}</td>
                  <td className="py-2 pr-2 font-qsr-mono">{s.learners}</td>
                  <td className="py-2 pr-2 font-qsr-mono">{s.completed}</td>
                  <td className="py-2"><RateBar rate={s.rate} /></td>
                </tr>
              ))}
              {(byStoreQ.data?.stores ?? []).length === 0 && <tr><td colSpan={5} className="py-3 font-qsr-ui text-sm text-ink-muted">No learners mapped to stores yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <AssignmentsPanel />
    </div>
  );
}

function AssignmentsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const targetsQ = useQuery({ queryKey: ["qsr", "manage", "targets"], queryFn: fetchAssignTargets });
  const listQ = useQuery({ queryKey: ["qsr", "manage", "assignments"], queryFn: fetchAssignments });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["qsr", "manage", "assignments"] });

  const [courseId, setCourseId] = useState("");
  const [scope, setScope] = useState<"all" | "store">("all");
  const [storeId, setStoreId] = useState("");
  const [due, setDue] = useState("");

  const add = useMutation({
    mutationFn: () => {
      const store = (targetsQ.data?.stores ?? []).find((s) => s.id === storeId);
      return createAssignment({
        course_id: courseId,
        scope_type: scope,
        scope_id: scope === "store" ? storeId : null,
        scope_label: scope === "store" ? (store ? `${store.number} — ${store.name}` : null) : "Everyone",
        due_at: due ? new Date(due).toISOString() : null,
      });
    },
    onSuccess: () => { toast.push("Assignment created.", "success"); setCourseId(""); setStoreId(""); setDue(""); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteAssignment(id),
    onSuccess: () => { toast.push("Assignment removed.", "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Failed.", "error"),
  });

  const canAdd = courseId && (scope === "all" || storeId);

  return (
    <div className={card}>
      <h2 className="mb-3 font-qsr-display text-lg font-semibold text-ink">Assignments</h2>

      <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_auto_1fr_auto_auto] sm:items-center">
        <select className={inputCls} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Choose a course…</option>
          {(targetsQ.data?.courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}{c.status !== "published" ? " (draft)" : ""}</option>)}
        </select>
        <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as "all" | "store")}>
          <option value="all">Everyone</option>
          <option value="store">A store</option>
        </select>
        {scope === "store" ? (
          <select className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Choose a store…</option>
            {(targetsQ.data?.stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.number} — {s.name}</option>)}
          </select>
        ) : <div className="font-qsr-ui text-xs text-ink-subtle">All active learners</div>}
        <input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} title="Due date (optional)" />
        <button type="button" onClick={() => add.mutate()} disabled={!canAdd || add.isPending} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-qsr-azure px-3 py-2 font-qsr-ui text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Assign
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {listQ.isLoading ? <div className="h-12 animate-pulse rounded-xl bg-surface-sunk" /> :
          (listQ.data?.assignments ?? []).length === 0 ? <p className="font-qsr-ui text-sm text-ink-muted">No assignments yet.</p> :
          (listQ.data?.assignments ?? []).map((a: Assignment) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-qsr-ui text-sm font-semibold text-ink">{a.course_title}</div>
                <div className="font-qsr-ui text-[11px] text-ink-muted">
                  {a.scope_label || (a.scope_type === "all" ? "Everyone" : a.scope_type)}
                  {a.due_at ? ` · due ${new Date(a.due_at).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-qsr-mono text-sm text-ink">{a.completed}/{a.total}</div>
                <div className="font-qsr-ui text-[10px] uppercase tracking-wide text-ink-subtle">done</div>
              </div>
              <RateBar rate={a.total ? Math.round((a.completed / a.total) * 100) : 0} />
              <button type="button" onClick={() => remove.mutate(a.id)} className="rounded-md p-1.5 text-ink-subtle hover:text-qsr-crimson" title="Remove"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
      </div>
    </div>
  );
}
