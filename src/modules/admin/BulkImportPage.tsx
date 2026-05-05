import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, Upload } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { downloadCSV, parseCSVWithHeader, toCSV } from "@/lib/csv";
import {
  bulkImport,
  bulkPreview,
  type BulkImportResponse,
  type BulkPreviewResponse,
  type BulkRowAnnotated,
  type BulkRowInput,
} from "@/modules/team/api";

const TEMPLATE_HEADERS = [
  "email",
  "full_name",
  "phone",
  "role",
  "scope_type",
  "scope_id_or_code",
];

const TEMPLATE_ROWS = [
  {
    email: "jane.smith@sonic.com",
    full_name: "Jane Smith",
    phone: "5551234567",
    role: "gm",
    scope_type: "store",
    scope_id_or_code: "1706",
  },
  {
    email: "alex.kim@sonic.com",
    full_name: "Alex Kim",
    phone: "5556667777",
    role: "sdo",
    scope_type: "area",
    scope_id_or_code: "Area 08",
  },
  {
    email: "sam.rivera@sonic.com",
    full_name: "Sam Rivera",
    phone: "",
    role: "rvp",
    scope_type: "region",
    scope_id_or_code: "R4",
  },
  {
    email: "admin@sonic.com",
    full_name: "Admin User",
    phone: "",
    role: "admin",
    scope_type: "global",
    scope_id_or_code: "",
  },
];

export function BulkImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<BulkRowInput[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkPreviewResponse | null>(null);
  const [imported, setImported] = useState<BulkImportResponse | null>(null);

  const previewMut = useMutation({
    mutationFn: bulkPreview,
    onSuccess: (data) => setPreview(data),
    onError: (e: unknown) =>
      setParseError(e instanceof Error ? e.message : "Preview failed."),
  });

  const importMut = useMutation({
    mutationFn: bulkImport,
    onSuccess: (data) => {
      setImported(data);
      qc.invalidateQueries({ queryKey: ["my-team"] });
      toast.push(`Imported: ${data.summary.invited} invites sent.`, "success");
    },
    onError: (e: unknown) =>
      setParseError(e instanceof Error ? e.message : "Import failed."),
  });

  function downloadTemplate() {
    const csv = toCSV(TEMPLATE_HEADERS, TEMPLATE_ROWS);
    downloadCSV("bulk-import-template.csv", csv);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRawText(text);
      ingest(text);
    };
    reader.readAsText(f);
  }

  function ingestPasted() {
    ingest(rawText);
  }

  function ingest(text: string) {
    setParseError(null);
    setPreview(null);
    setImported(null);
    const rows = parseCSVWithHeader(text);
    if (rows.length === 0) {
      setParseError("Couldn't parse any rows. Did you include a header row?");
      setParsed(null);
      return;
    }
    // Validate header presence
    const missing = TEMPLATE_HEADERS.filter((h) => !(h in rows[0]));
    if (missing.length > 0) {
      setParseError(
        `Missing required columns: ${missing.join(", ")}. Download the template if unsure.`
      );
      setParsed(null);
      return;
    }
    const normalized: BulkRowInput[] = rows.map((r) => ({
      email: r.email,
      full_name: r.full_name,
      phone: r.phone,
      role: r.role,
      scope_type: r.scope_type,
      scope_id_or_code: r.scope_id_or_code,
    }));
    setParsed(normalized);
    previewMut.mutate(normalized);
  }

  function reset() {
    setRawText("");
    setParsed(null);
    setParseError(null);
    setPreview(null);
    setImported(null);
  }

  return (
    <>
      <PageHeader
        title="Bulk import users"
        description="Upload a CSV to invite many users at once."
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Template
            </Button>
          </div>
        }
      />

      {!parsed && !imported && (
        <Card>
          <CardHeader title="1. Upload your CSV" />
          <CardBody className="space-y-4">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <p className="font-medium text-midnight">Required columns:</p>
              <p className="mt-1 font-mono text-xs">
                {TEMPLATE_HEADERS.join(", ")}
              </p>
              <p className="mt-2 text-xs text-zinc-600">
                Roles: <code>shift_manager</code>, <code>gm</code>, <code>do</code>,{" "}
                <code>sdo</code>, <code>rvp</code>, <code>vp</code>,{" "}
                <code>coo</code>, <code>admin</code>, <code>payroll</code>.
                <br />
                Scope types: <code>store</code> (+ store number),{" "}
                <code>district</code> (+ code like D101), <code>area</code> (+
                code like Area 08), <code>region</code> (+ code like R4),{" "}
                <code>global</code> (leave code blank).
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Pick CSV file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onFile}
              />
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                …or paste CSV text
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={6}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 font-mono text-xs text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="email,full_name,phone,role,scope_type,scope_id_or_code"
              />
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={ingestPasted}
                  disabled={!rawText.trim()}
                >
                  Validate pasted text
                </Button>
              </div>
            </div>

            {parseError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {parseError}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {parsed && preview && !imported && (
        <PreviewTable
          preview={preview}
          submitting={importMut.isPending}
          onCancel={reset}
          onConfirm={() => importMut.mutate(parsed)}
        />
      )}

      {imported && <ResultsTable imported={imported} onReset={reset} />}

      {previewMut.isPending && (
        <p className="mt-2 text-sm text-zinc-500">Validating…</p>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Preview table — shows server-validated rows; admin confirms before invites.
// ----------------------------------------------------------------------------

function PreviewTable({
  preview,
  submitting,
  onCancel,
  onConfirm,
}: {
  preview: BulkPreviewResponse;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { rows, summary } = preview;
  const status = useMemo(
    () => (r: BulkRowAnnotated) => {
      if (r.errors.length > 0) return { tone: "danger" as const, label: "Error" };
      if (r.already_exists) return { tone: "neutral" as const, label: "Skip" };
      return { tone: "success" as const, label: "Ready" };
    },
    []
  );

  return (
    <Card>
      <CardHeader
        title="2. Review"
        description={`${summary.valid} ready · ${summary.skipped} skipped · ${summary.invalid} error`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Start over
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={submitting || summary.valid === 0}
            >
              {submitting
                ? "Sending invites…"
                : `Send ${summary.valid} invite${summary.valid === 1 ? "" : "s"}`}
            </Button>
          </div>
        }
      />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-left text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => {
                const s = status(r);
                return (
                  <tr key={r.row} className={r.errors.length > 0 ? "bg-red-50/30" : undefined}>
                    <td className="px-3 py-2 text-zinc-500">{r.row}</td>
                    <td className="px-3 py-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono">{r.email}</td>
                    <td className="px-3 py-2">{r.full_name ?? <span className="text-zinc-400">—</span>}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className="px-3 py-2">
                      {r.scope_type}
                      {r.scope_code ? ` · ${r.scope_code}` : ""}
                    </td>
                    <td className="px-3 py-2 text-zinc-600">
                      {r.errors.length > 0 ? (
                        <span className="text-red-700">{r.errors.join("; ")}</span>
                      ) : r.warnings.length > 0 ? (
                        <span className="text-amber-700">{r.warnings.join("; ")}</span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// Results — post-import summary.
// ----------------------------------------------------------------------------

function ResultsTable({
  imported,
  onReset,
}: {
  imported: BulkImportResponse;
  onReset: () => void;
}) {
  const { results, summary } = imported;
  return (
    <Card>
      <CardHeader
        title="3. Results"
        description={`${summary.invited} invited · ${summary.skipped} skipped · ${summary.errors} error`}
        actions={
          <Button variant="primary" size="sm" onClick={onReset}>
            Import another
          </Button>
        }
      />
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-left text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {results.map((r) => (
                <tr key={r.row}>
                  <td className="px-3 py-2 text-zinc-500">{r.row}</td>
                  <td className="px-3 py-2">
                    {r.status === "invited" && (
                      <Badge tone="success" className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                        Invited
                      </Badge>
                    )}
                    {r.status === "skipped" && <Badge tone="neutral">Skipped</Badge>}
                    {r.status === "error" && (
                      <Badge tone="danger" className="inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" strokeWidth={2} />
                        Error
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.email}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
