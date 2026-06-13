// ATS roster bulk import. Paste or upload a CSV exported from the ATS;
// validate (resolve stores in scope, map role titles, flag dupes) before
// applying. Upserts on external_id (else store + name) and never touches the
// talent overlay. Replaces the admin "Seed from profiles" stop-gap.
import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Download, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { downloadCSV, parseCSVWithHeader, toCSV } from "@/lib/csv";
import {
  importPreview, importRoster,
  type ImportMode, type ImportPreviewResponse, type ImportRosterResponse, type ImportRowInput,
} from "./api";

const HEADERS = ["external_id", "full_name", "store_number", "role", "email", "phone", "status", "hire_date"];
const SAMPLE: Record<string, string>[] = [
  { external_id: "ATS-1001", full_name: "Jordan Rivera", store_number: "9999", role: "General Manager", email: "jordan@example.com", phone: "5551234567", status: "active", hire_date: "2023-04-10" },
  { external_id: "ATS-1002", full_name: "Sam Lee", store_number: "9999", role: "Shift Manager", email: "", phone: "", status: "active", hire_date: "2024-01-15" },
  { external_id: "ATS-1003", full_name: "Alex Kim", store_number: "9999", role: "Carhop", email: "", phone: "", status: "loa", hire_date: "" },
];

export function RosterImport({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ImportRowInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [result, setResult] = useState<ImportRosterResponse | null>(null);
  const [mode, setMode] = useState<ImportMode>("all");

  const previewMut = useMutation({
    mutationFn: importPreview,
    onSuccess: setPreview,
    onError: (e: unknown) => setError((e as Error)?.message ?? "Validation failed."),
  });
  const importMut = useMutation({
    mutationFn: (rows: ImportRowInput[]) => importRoster(rows, mode),
    onSuccess: (d) => {
      setResult(d);
      qc.invalidateQueries({ queryKey: ["tp-rollup"] });
      qc.invalidateQueries({ queryKey: ["tp-gms"] });
      qc.invalidateQueries({ queryKey: ["tp-store-roster"] });
      toast.push(`Imported: ${d.summary.created} created, ${d.summary.updated} updated${d.summary.skipped ? `, ${d.summary.skipped} skipped` : ""}.`, "success");
    },
    onError: (e: unknown) => setError((e as Error)?.message ?? "Import failed."),
  });

  function ingest(text: string) {
    setError(null); setPreview(null); setResult(null);
    const rows = parseCSVWithHeader(text);
    if (rows.length === 0) { setError("Couldn't parse any rows. Include a header row."); setParsed(null); return; }
    const headers = Object.keys(rows[0]);
    for (const req of ["full_name", "store_number", "role"]) {
      if (!headers.includes(req)) { setError(`Missing required column: ${req}. Download the template if unsure.`); setParsed(null); return; }
    }
    const normalized = rows.map((r) => {
      const out: ImportRowInput = {};
      for (const h of HEADERS) if (r[h] !== undefined) out[h] = r[h];
      return out;
    });
    setParsed(normalized);
    previewMut.mutate(normalized);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { const t = String(reader.result ?? ""); setRawText(t); ingest(t); };
    reader.readAsText(f);
  }

  function reset() { setRawText(""); setParsed(null); setError(null); setPreview(null); setResult(null); }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onDone} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
          <ArrowLeft className="h-4 w-4" />Back to districts
        </button>
        <h1 className="text-xl font-bold tracking-tight text-heading">Import roster (ATS)</h1>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => downloadCSV("roster-import-template.csv", toCSV(HEADERS, SAMPLE))}>
          <Download className="mr-1 h-3.5 w-3.5" />Template
        </Button>
      </div>

      {!parsed && !result && (
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="rounded-lg bg-surface-muted px-3 py-2.5 text-sm text-ink-2">
            <p className="font-semibold text-heading">Columns</p>
            <p className="mt-1 font-mono text-xs">{HEADERS.join(", ")}</p>
            <p className="mt-2 text-xs text-ink-muted">
              <code>full_name</code>, <code>store_number</code>, and <code>role</code> are required. Role accepts titles
              (General Manager, Shift Manager, Carhop…) or ladder keys (gm, shift, carhop). Stores resolve by number,
              limited to your scope. Rows match existing members by <code>external_id</code> (else store + name) — matches
              <strong> update</strong>, the rest <strong>create</strong>. Talent data (flight risk, ratings, notes) is never overwritten.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" />Pick CSV file
            </Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </div>

          <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-ink-subtle">…or paste CSV text</label>
          <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={6}
            placeholder="Paste your ATS export here (header row + rows)…"
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-heading focus:border-accent focus:outline-none" />
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" size="sm" disabled={!rawText.trim()} onClick={() => ingest(rawText)}>Validate</Button>
          </div>
          {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        </div>
      )}

      {previewMut.isPending && <p className="text-sm text-ink-muted">Validating…</p>}

      {parsed && preview && !result && (() => {
        const willApply = mode === "new" ? preview.summary.create : mode === "update" ? preview.summary.update : preview.summary.create + preview.summary.update;
        return (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-heading">
              {preview.summary.create} new · {preview.summary.update} update · <span className={preview.summary.error ? "text-red-600" : ""}>{preview.summary.error} error</span>
            </span>
            <div className="flex items-center gap-1.5 rounded-lg bg-surface-sunk p-0.5">
              {([["all", "All"], ["new", "Only new"], ["update", "Only update"]] as [ImportMode, string][]).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-semibold transition", mode === m ? "bg-surface text-heading shadow-sm" : "text-ink-muted hover:text-heading")}>{label}</button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {importMut.isPending && <span className="text-xs text-ink-muted">Writing {willApply} record{willApply === 1 ? "" : "s"}…</span>}
              <Button variant="ghost" size="sm" disabled={importMut.isPending} onClick={reset}>Start over</Button>
              <Button variant="primary" size="sm" disabled={importMut.isPending || willApply === 0}
                onClick={() => importMut.mutate(parsed)}>
                {importMut.isPending ? "Importing…" : `Apply ${willApply} change${willApply === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
          {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-muted text-left text-ink-subtle">
                <tr>{["#", "Action", "Name", "Store", "Role", "Notes"].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.row} className={r.action === "error" ? "bg-red-50/40" : undefined}>
                    <td className="px-3 py-2 text-ink-subtle">{r.row}</td>
                    <td className="px-3 py-2"><ActionPill action={r.action} /></td>
                    <td className="px-3 py-2 font-medium text-heading">{r.full_name || "—"}</td>
                    <td className="px-3 py-2 font-mono">{r.store_number || "—"}</td>
                    <td className="px-3 py-2">{r.role ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.errors.length > 0 ? <span className="text-red-700">{r.errors.join("; ")}</span>
                        : r.warnings.length > 0 ? <span className="text-amber-700">{r.warnings.join("; ")}</span> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {result && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-emerald-50/60 px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
            <div>
              <div className="text-sm font-bold text-heading">Import complete</div>
              <div className="text-xs text-ink-muted">
                <strong className="text-emerald-700">{result.summary.created}</strong> created · <strong className="text-blue-700">{result.summary.updated}</strong> updated
                {result.summary.skipped ? <> · {result.summary.skipped} skipped</> : null}
                {result.summary.errors ? <> · <strong className="text-red-600">{result.summary.errors}</strong> error{result.summary.errors === 1 ? "" : "s"}</> : null}
              </div>
            </div>
            <Button variant="primary" size="sm" className="ml-auto" onClick={reset}>Import another</Button>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-muted text-left text-ink-subtle">
                <tr>{["#", "Status", "Name", "Notes"].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.results.map((r) => (
                  <tr key={r.row} className={r.status === "error" ? "bg-red-50/40" : undefined}>
                    <td className="px-3 py-2 text-ink-subtle">{r.row}</td>
                    <td className="px-3 py-2"><ResultPill status={r.status} /></td>
                    <td className="px-3 py-2 font-medium text-heading">{r.full_name || "—"}</td>
                    <td className="px-3 py-2 text-ink-muted">{r.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionPill({ action }: { action: "create" | "update" | "error" }) {
  const m = { create: "bg-emerald-50 text-emerald-700", update: "bg-blue-50 text-blue-700", error: "bg-red-50 text-red-700" }[action];
  const label = { create: "New", update: "Update", error: "Error" }[action];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", m)}>{label}</span>;
}
function ResultPill({ status }: { status: "created" | "updated" | "skipped" | "error" }) {
  const m = { created: "bg-emerald-50 text-emerald-700", updated: "bg-blue-50 text-blue-700", skipped: "bg-zinc-100 text-zinc-500", error: "bg-red-50 text-red-700" }[status];
  const label = { created: "Created", updated: "Updated", skipped: "Skipped", error: "Error" }[status];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", m)}>{label}</span>;
}
