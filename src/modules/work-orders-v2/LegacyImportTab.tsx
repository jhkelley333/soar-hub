// Settings sub-tab: import legacy Work Orders (Smartsheet) into WO2.
// Admin-only. Two-stage flow: Preview → review summary → Execute.
// Idempotent via tickets.legacy_smartsheet_row_id.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, PlayCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/shared/ui/Button";
import { Card, CardBody } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";

interface PreviewSummary {
  cutoff: string;
  windowDays: number;
  total_smartsheet_rows: number;
  in_window: number;
  ready_to_import: number;
  will_skip: number;
  skip_reasons: Record<string, number>;
  status_breakdown: Record<string, number>;
  unmapped_smartsheet_statuses: Record<string, number>;
  unmatched_vendors: Record<string, number>;
  sample_ready: Array<{
    legacy_row: string;
    store: string;
    submitted: string;
    submitted_by: string;
    raw_status: string;
    mapped_status: string;
    pause_state: string;
    approval: string;
    vendor: string;
    vendor_matched: boolean;
    description: string;
  }>;
  sample_skipped: Array<{
    legacy_row: string;
    store: string;
    reason: string;
    submitted: string;
  }>;
}

interface ExecuteResult {
  summary: PreviewSummary;
  inserted_count: number;
  failed_count: number;
  inserted: Array<{ legacy_row: string; wo_number: string; store: string; status: string }>;
  failed: Array<{ legacy_row: string; reason: string }>;
}

async function callImport(action: "preview" | "execute", windowDays: number) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in required.");
  const res = await fetch(`/.netlify/functions/wo-legacy-import?action=${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ windowDays }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body.message || `Import ${action} failed: ${res.status}`);
  }
  return body;
}

export function LegacyImportTab() {
  const { profile } = useAuth();
  const toast = useToast();
  const isAdmin = (profile?.role || "").toLowerCase() === "admin";

  const [windowDays, setWindowDays] = useState(30);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<PreviewSummary | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [confirmText, setConfirmText] = useState("");

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admin only"
        description="Importing legacy Work Orders is restricted to admins."
      />
    );
  }

  async function doPreview() {
    setPreviewing(true);
    setResult(null);
    try {
      const res = await callImport("preview", windowDays);
      setPreview(res.preview);
      toast.push(
        `Preview: ${res.preview.ready_to_import} ready, ${res.preview.will_skip} skipped.`,
        "info",
      );
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Preview failed.", "error");
    } finally {
      setPreviewing(false);
    }
  }

  async function doExecute() {
    if (!preview) return;
    if (confirmText.trim().toUpperCase() !== "IMPORT") {
      toast.push('Type IMPORT to confirm.', "error");
      return;
    }
    setExecuting(true);
    try {
      const res = await callImport("execute", windowDays);
      setResult(res);
      toast.push(
        `Imported ${res.inserted_count} ticket(s); ${res.failed_count} failed.`,
        res.failed_count === 0 ? "success" : "info",
      );
      setConfirmText("");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Import failed.", "error");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="text-sm font-semibold tracking-tight text-midnight">
            Import legacy Work Orders
          </div>
          <p className="text-xs text-zinc-600">
            One-way port from the Smartsheet-backed Work Orders V1 into
            Supabase-backed V2. Idempotent: each Smartsheet row is tagged with
            <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-[10px]">legacy_smartsheet_row_id</code>,
            so re-runs skip what's already imported.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="li-days">Window (days back)</Label>
              <Input
                id="li-days"
                type="number"
                min={1}
                max={365}
                value={windowDays}
                onChange={(e) => setWindowDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
                className="w-32"
              />
            </div>
            <Button variant="ghost" onClick={doPreview} disabled={previewing}>
              {previewing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />}
              Preview
            </Button>
          </div>
        </CardBody>
      </Card>

      {preview && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold tracking-tight text-midnight">
                Preview ({preview.windowDays}d back)
              </div>
              <div className="text-[11px] text-zinc-500">
                Cutoff: {new Date(preview.cutoff).toLocaleString()}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label="Smartsheet total" value={preview.total_smartsheet_rows} />
              <Stat label="In window" value={preview.in_window} />
              <Stat label="Ready" value={preview.ready_to_import} tone="success" />
              <Stat label="Will skip" value={preview.will_skip} tone={preview.will_skip > 0 ? "warning" : "neutral"} />
            </div>

            {Object.keys(preview.skip_reasons).length > 0 && (
              <DetailsBlock label="Skip reasons" data={preview.skip_reasons} />
            )}
            {Object.keys(preview.status_breakdown).length > 0 && (
              <DetailsBlock label="Status breakdown (after mapping)" data={preview.status_breakdown} />
            )}
            {Object.keys(preview.unmapped_smartsheet_statuses).length > 0 && (
              <DetailsBlock
                label="Unmapped Smartsheet statuses (defaulted to submitted)"
                data={preview.unmapped_smartsheet_statuses}
                warn
              />
            )}
            {Object.keys(preview.unmatched_vendors).length > 0 && (
              <DetailsBlock
                label="Unmatched vendor names (will store as free-text only)"
                data={preview.unmatched_vendors}
                warn
              />
            )}

            <SampleTable title="Sample (ready to import)" rows={preview.sample_ready} />
            {preview.sample_skipped.length > 0 && (
              <SkipTable rows={preview.sample_skipped} />
            )}

            {preview.ready_to_import > 0 && !result && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
                <div className="mb-2 flex items-center gap-1.5 font-semibold text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Confirm import
                </div>
                <p className="mb-2 text-amber-900">
                  This will insert {preview.ready_to_import} ticket(s) into V2. Type{" "}
                  <code className="rounded bg-white px-1 py-0.5">IMPORT</code> to enable the button.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="IMPORT"
                    className="w-32"
                  />
                  <Button
                    variant="primary"
                    onClick={doExecute}
                    disabled={executing || confirmText.trim().toUpperCase() !== "IMPORT"}
                  >
                    {executing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />}
                    Run import
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {result && (
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold tracking-tight text-midnight">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
              Import complete
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Stat label="Inserted" value={result.inserted_count} tone="success" />
              <Stat label="Failed" value={result.failed_count} tone={result.failed_count > 0 ? "danger" : "neutral"} />
            </div>
            {result.failed.length > 0 && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-900">
                <div className="mb-1 font-semibold">Failed rows:</div>
                <ul className="space-y-0.5">
                  {result.failed.slice(0, 20).map((f) => (
                    <li key={f.legacy_row}>
                      <code>{f.legacy_row}</code> — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-zinc-500">
              Imported tickets are searchable in the Tickets tab. Each one carries
              <code className="mx-1 rounded bg-zinc-100 px-1">legacy_smartsheet_row_id</code>
              so you can audit / roll back with:
              <code className="mx-1 rounded bg-zinc-100 px-1">
                delete from tickets where legacy_smartsheet_row_id is not null;
              </code>
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: { label: string; value: number; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const toneClass =
    tone === "success" ? "text-emerald-700"
    : tone === "warning" ? "text-amber-700"
    : tone === "danger" ? "text-red-700"
    : "text-midnight";
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-base font-semibold ${toneClass}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function DetailsBlock({
  label,
  data,
  warn = false,
}: { label: string; data: Record<string, number>; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-2 text-[11px] ${warn ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-zinc-50"}`}>
      <div className="mb-1 font-semibold text-zinc-700">{label}</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(data).map(([k, v]) => (
          <Badge key={k} tone={warn ? "warning" : "neutral"}>
            {k}: {v}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function SampleTable({
  title,
  rows,
}: { title: string; rows: PreviewSummary["sample_ready"] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-zinc-600">{title} (first {rows.length})</div>
      <div className="overflow-x-auto rounded-md border border-zinc-200">
        <table className="w-full text-[11px]">
          <thead className="bg-zinc-50">
            <tr className="text-left text-zinc-600">
              <th className="px-2 py-1">Store</th>
              <th className="px-2 py-1">Submitted</th>
              <th className="px-2 py-1">By</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Approval</th>
              <th className="px-2 py-1">Vendor</th>
              <th className="px-2 py-1">Desc</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.legacy_row} className="border-t border-zinc-100">
                <td className="px-2 py-1">{r.store}</td>
                <td className="px-2 py-1">{new Date(r.submitted).toLocaleDateString()}</td>
                <td className="px-2 py-1">{r.submitted_by}</td>
                <td className="px-2 py-1">
                  <Badge tone="info">{r.mapped_status}</Badge>
                  {r.pause_state !== "none" && (
                    <Badge tone="warning">{r.pause_state}</Badge>
                  )}
                </td>
                <td className="px-2 py-1">{r.approval}</td>
                <td className="px-2 py-1">
                  {r.vendor}
                  {r.vendor !== "—" && !r.vendor_matched && (
                    <span className="ml-1 text-amber-700">(no match)</span>
                  )}
                </td>
                <td className="px-2 py-1 max-w-[260px] truncate">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkipTable({
  rows,
}: { rows: PreviewSummary["sample_skipped"] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold text-zinc-600">Sample (will skip)</div>
      <div className="overflow-x-auto rounded-md border border-zinc-200">
        <table className="w-full text-[11px]">
          <thead className="bg-zinc-50">
            <tr className="text-left text-zinc-600">
              <th className="px-2 py-1">Store</th>
              <th className="px-2 py-1">Submitted</th>
              <th className="px-2 py-1">Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.legacy_row} className="border-t border-zinc-100">
                <td className="px-2 py-1">{r.store}</td>
                <td className="px-2 py-1">{r.submitted === "—" ? "—" : new Date(r.submitted).toLocaleDateString()}</td>
                <td className="px-2 py-1">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
