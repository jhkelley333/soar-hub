// /admin/reports — the report engine console. Admins list report definitions,
// toggle them, edit recipients + schedule, send a test to themselves, run now,
// and view the last 30 runs (including failures). Data: netlify/functions/reports.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Clock, Play, Plus, Send, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import {
  fetchReports, fetchReportRuns, updateReport, sendReportTest, runReportNow,
  type Recipient, type ReportDefinition, type ReportRun,
} from "./api";

const STATUS_TONE: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  skipped: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};
const fmtWhen = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export function ReportsAdminPage() {
  const q = useQuery({ queryKey: ["reports"], queryFn: fetchReports, staleTime: 30_000 });
  return (
    <>
      <PageHeader
        title="Reports"
        description="Scheduled + event reports. Recipients and schedules edit here — no deploy needed."
      />
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load reports" description={(q.error as Error)?.message ?? "Try again."} />
      ) : (q.data?.definitions.length ?? 0) === 0 ? (
        <EmptyState title="No reports yet" description="Report definitions appear here as they're added." />
      ) : (
        <div className="space-y-3">
          {q.data!.definitions.map((d) => <ReportCard key={d.key} def={d} />)}
        </div>
      )}
    </>
  );
}

function ReportCard({ def }: { def: ReportDefinition }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showRuns, setShowRuns] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>(def.recipients ?? []);
  const [cron, setCron] = useState(def.cron ?? "");
  const dirty = JSON.stringify(recipients) !== JSON.stringify(def.recipients ?? []) || (cron !== (def.cron ?? ""));

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reports"] });

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateReport>[1]) => updateReport(def.key, patch),
    onSuccess: () => { toast.push("Saved.", "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });
  const test = useMutation({
    mutationFn: () => sendReportTest(def.key),
    onSuccess: (r) => { toast.push(`Test sent to ${r.sent_to} (${r.run.status}).`, r.run.status === "failed" ? "error" : "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Test failed.", "error"),
  });
  const runNow = useMutation({
    mutationFn: () => runReportNow(def.key),
    onSuccess: (r) => { toast.push(`Ran — ${r.run.status}, ${r.run.recipient_count ?? 0} recipient(s).`, r.run.status === "failed" ? "error" : "success"); invalidate(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Run failed.", "error"),
  });

  const latest = def.latest_run;
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-midnight">{def.name}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{def.trigger_type}</span>
              {latest && (
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset", STATUS_TONE[latest.status] ?? STATUS_TONE.skipped)}>
                  {latest.status}
                </span>
              )}
            </div>
            {def.description && <p className="mt-0.5 text-xs text-zinc-500">{def.description}</p>}
            <p className="mt-1 text-[11px] text-zinc-400">
              <span className="font-mono">{def.key}</span>
              {latest ? ` · last run ${fmtWhen(latest.completed_at ?? latest.started_at)}` : " · never run"}
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-zinc-600">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={def.enabled}
              onChange={(e) => save.mutate({ enabled: e.target.checked })} />
            Enabled
          </label>
        </div>

        {/* Schedule */}
        {def.trigger_type === "schedule" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-zinc-600">Cron</span>
            <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 8 * * 1"
              className="w-36 rounded-md border border-zinc-200 px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none" />
            <span className="text-zinc-400">{def.timezone}</span>
            <label className="ml-2 flex items-center gap-1.5 text-zinc-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={def.send_when_empty}
                onChange={(e) => save.mutate({ send_when_empty: e.target.checked })} />
              Send when empty
            </label>
          </div>
        )}

        {/* Recipients */}
        <RecipientsEditor recipients={recipients} onChange={setRecipients} />

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          <Button size="sm" variant="secondary" disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ recipients, cron: cron.trim() || null })}>
            <Check className="mr-1 h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save changes"}
          </Button>
          <Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
            <Send className="mr-1 h-3.5 w-3.5" /> {test.isPending ? "Sending…" : "Send test to me"}
          </Button>
          <Button size="sm" variant="secondary" className="text-amber-800 ring-amber-300 hover:bg-amber-50"
            disabled={runNow.isPending}
            onClick={() => { if (window.confirm(`Run "${def.name}" now and send to its real recipients?`)) runNow.mutate(); }}>
            <Play className="mr-1 h-3.5 w-3.5" /> {runNow.isPending ? "Running…" : "Run now"}
          </Button>
          <button type="button" onClick={() => setShowRuns((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            <Clock className="h-3.5 w-3.5" /> History
            <ChevronDown className={cn("h-3.5 w-3.5 transition", showRuns && "rotate-180")} />
          </button>
        </div>

        {showRuns && <RunHistory reportKey={def.key} />}
      </CardBody>
    </Card>
  );
}

function RecipientsEditor({ recipients, onChange }: { recipients: Recipient[]; onChange: (r: Recipient[]) => void }) {
  const [mode, setMode] = useState<"role" | "static">("role");
  const [value, setValue] = useState("");
  const add = () => {
    const v = value.trim();
    if (!v) return;
    onChange([...recipients, { mode, value: mode === "role" ? v.toLowerCase() : v }]);
    setValue("");
  };
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Recipients</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {recipients.length === 0 && <span className="text-xs text-zinc-400">None — add a role or address.</span>}
        {recipients.map((r, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
            r.mode === "role" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-sky-50 text-sky-700 ring-sky-200")}>
            {r.mode === "role" ? `role: ${r.value}` : r.value}
            <button type="button" onClick={() => onChange(recipients.filter((_, j) => j !== i))} className="text-current/60 hover:text-current">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex overflow-hidden rounded-md ring-1 ring-inset ring-zinc-200">
          {(["role", "static"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={cn("px-2 py-1 font-semibold", mode === m ? "bg-accent text-white" : "bg-white text-zinc-500 hover:bg-zinc-50")}>
              {m === "role" ? "Role" : "Address"}
            </button>
          ))}
        </span>
        <input value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={mode === "role" ? "coo, rvp, admin…" : "name@company.com"}
          className="w-52 rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-accent focus:outline-none" />
        <Button size="sm" variant="ghost" onClick={add}><Plus className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

function RunHistory({ reportKey }: { reportKey: string }) {
  const q = useQuery({ queryKey: ["report-runs", reportKey], queryFn: () => fetchReportRuns(reportKey), staleTime: 15_000 });
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  const runs = q.data?.runs ?? [];
  if (!runs.length) return <p className="text-xs text-zinc-400">No runs recorded yet.</p>;
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
      <table className="w-full text-xs">
        <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-400">
          <tr><th className="px-3 py-1.5">When</th><th className="px-3 py-1.5">Status</th><th className="px-3 py-1.5 text-right">Recipients</th><th className="px-3 py-1.5 text-right">Rows</th><th className="px-3 py-1.5">Detail</th></tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {runs.map((r: ReportRun) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap px-3 py-1.5 text-zinc-600">{fmtWhen(r.completed_at ?? r.started_at)}</td>
              <td className="px-3 py-1.5">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset", STATUS_TONE[r.status] ?? STATUS_TONE.skipped)}>{r.status}</span>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">{r.recipient_count ?? "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">{r.row_count ?? "—"}</td>
              <td className="px-3 py-1.5 text-zinc-500">
                {r.error ? <span className="inline-flex items-center gap-1 text-red-600"><AlertTriangle className="h-3 w-3" />{r.error}</span>
                  : r.payload_summary?.test ? "test" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
