import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, Upload } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { downloadCSV, parseCSVWithHeader, toCSV } from "@/lib/csv";
import {
  orgBulkImport,
  orgBulkPreview,
  type OrgBulkImportResponse,
  type OrgBulkPreviewResponse,
  type OrgBulkRowAnnotated,
  type OrgBulkRowInput,
} from "./api";

// Bulk import semantics (post-0028 hardening):
//   • Empty / missing column = "don't update this field" (partial update)
//   • Literal value `NULL` (case-insensitive) = "explicitly clear to null"
//   • Booleans accept true/false/yes/no/1/0
//   • drive_thru_lanes: 1 or 2
//   • drive_thru_type: single_pole_two_menus | split_housing
//   • third_party_delivery: comma-list of provider keys, e.g.
//     "doordash,ubereats,grubhub"
const TEMPLATE_HEADERS = [
  "kind",
  "code",
  "name",
  "number",
  "phone",
  "email",
  "address",
  "city",
  "state",
  "zip",
  "plate_iq_email",
  "soar_company_name",
  "has_apple_pay",
  "has_order_ahead",
  "has_outdoor_seating",
  "has_drive_thru",
  "has_clearance_bar",
  "drive_thru_lanes",
  "drive_thru_type",
  "public_restroom_count",
  "patio_pop_menu_count",
  "patio_pop_stall_numbers",
  "order_ahead_stall_count",
  "order_ahead_stall_numbers",
  "stall_pop_menu_count",
  "has_trailer_stall",
  "trailer_stall_number",
  "third_party_delivery",
  "parent_code",
  "is_active",
];

// Build a template row factory so we don't repeat 30 empty fields four
// times below.
function emptyTemplateRow(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of TEMPLATE_HEADERS) out[h] = "";
  return out;
}

const TEMPLATE_ROWS: Record<string, string>[] = [
  {
    ...emptyTemplateRow(),
    kind: "region",
    code: "R5",
    name: "Mountain West",
    is_active: "true",
  },
  {
    ...emptyTemplateRow(),
    kind: "area",
    code: "Area 12",
    name: "Denver Metro",
    parent_code: "R5",
    is_active: "true",
  },
  {
    ...emptyTemplateRow(),
    kind: "district",
    code: "D125",
    name: "Denver North",
    parent_code: "Area 12",
    is_active: "true",
  },
  {
    ...emptyTemplateRow(),
    kind: "store",
    name: "Sample Store",
    number: "9999",
    phone: "5551234567",
    email: "store9999@soarqsr.com",
    address: "100 Sample St",
    city: "Denver",
    state: "CO",
    zip: "80202",
    plate_iq_email: "plateiq+9999@example.com",
    soar_company_name: "Soar Holdings LLC",
    has_apple_pay: "true",
    has_order_ahead: "true",
    has_outdoor_seating: "false",
    has_drive_thru: "true",
    has_clearance_bar: "true",
    drive_thru_lanes: "2",
    drive_thru_type: "split_housing",
    public_restroom_count: "1",
    patio_pop_menu_count: "4",
    patio_pop_stall_numbers: "1,2,3,4",
    order_ahead_stall_count: "2",
    order_ahead_stall_numbers: "5,6",
    stall_pop_menu_count: "8",
    has_trailer_stall: "false",
    trailer_stall_number: "",
    third_party_delivery: "doordash,ubereats,grubhub",
    parent_code: "D125",
    is_active: "true",
  },
];

export function BulkOrgImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<OrgBulkRowInput[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OrgBulkPreviewResponse | null>(null);
  const [imported, setImported] = useState<OrgBulkImportResponse | null>(null);

  const previewMut = useMutation({
    mutationFn: orgBulkPreview,
    onSuccess: (data) => setPreview(data),
    onError: (e: unknown) =>
      setParseError(e instanceof Error ? e.message : "Preview failed."),
  });

  const importMut = useMutation({
    mutationFn: orgBulkImport,
    onSuccess: (data) => {
      setImported(data);
      qc.invalidateQueries({ queryKey: ["org-tree"] });
      toast.push(
        `Imported: ${data.summary.created} created, ${data.summary.updated} updated.`,
        "success"
      );
    },
    onError: (e: unknown) =>
      setParseError(e instanceof Error ? e.message : "Import failed."),
  });

  function downloadTemplate() {
    const csv = toCSV(TEMPLATE_HEADERS, TEMPLATE_ROWS);
    downloadCSV("org-import-template.csv", csv);
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
    // Required headers, partial-update friendly: just `kind` plus an
    // identifier (`code` for non-stores or `number` for stores). All
    // other columns are optional — empty cells skip on update, the
    // literal "NULL" clears.
    const headers = Object.keys(rows[0]);
    if (!headers.includes("kind")) {
      setParseError(
        "Missing required column: kind. Download the template if unsure."
      );
      setParsed(null);
      return;
    }
    if (!headers.includes("code") && !headers.includes("number")) {
      setParseError(
        "Missing required column: include code (regions/areas/districts) or number (stores). Download the template if unsure."
      );
      setParsed(null);
      return;
    }
    // Pass every recognized header through. The backend's bulkCell()
    // helpers handle missing keys + "NULL" sentinel + type coercion.
    const PASS_THROUGH = TEMPLATE_HEADERS;
    const normalized: OrgBulkRowInput[] = rows.map((r) => {
      const row: Record<string, string> = {};
      for (const k of PASS_THROUGH) {
        if (r[k as keyof typeof r] !== undefined) {
          row[k] = r[k as keyof typeof r] as string;
        }
      }
      return row as unknown as OrgBulkRowInput;
    });
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
        title="Bulk import org tree"
        description="Upload a CSV to create or update regions, areas, districts, and stores."
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
                Kinds: <code>region</code>, <code>area</code>, <code>district</code>,{" "}
                <code>store</code>.
                <br />
                <code>code</code> is required for region/area/district (e.g. R4,
                Area 08, D101). <code>number</code> is required for store.
                <br />
                <code>parent_code</code> is required for non-region rows: a
                region's code for an area, an area's code for a district, a
                district's code for a store.
                <br />
                Existing rows (matched by code, or by number for stores) are{" "}
                <strong>updated</strong>; new rows are <strong>created</strong>.
                Order rows so parents appear before their children.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => fileRef.current?.click()}>
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
                placeholder="See template — empty cells skip; literal NULL clears."
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

function PreviewTable({
  preview,
  submitting,
  onCancel,
  onConfirm,
}: {
  preview: OrgBulkPreviewResponse;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { rows, summary } = preview;
  const validCount = summary.create + summary.update;
  return (
    <Card>
      <CardHeader
        title="2. Review"
        description={`${summary.create} new · ${summary.update} update · ${summary.invalid} error`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Start over
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={submitting || validCount === 0}
            >
              {submitting ? "Importing…" : `Apply ${validCount} change${validCount === 1 ? "" : "s"}`}
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
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Code / #</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Parent</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <RowLine key={r.row} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function RowLine({ r }: { r: OrgBulkRowAnnotated }) {
  const error = r.errors.length > 0;
  return (
    <tr className={error ? "bg-red-50/30" : undefined}>
      <td className="px-3 py-2 text-zinc-500">{r.row}</td>
      <td className="px-3 py-2">
        {error ? (
          <Badge tone="danger">Error</Badge>
        ) : r.action === "update" ? (
          <Badge tone="info">Update</Badge>
        ) : (
          <Badge tone="success">New</Badge>
        )}
      </td>
      <td className="px-3 py-2">{r.kind}</td>
      <td className="px-3 py-2 font-mono">{r.kind === "store" ? r.number ?? "" : r.code ?? ""}</td>
      <td className="px-3 py-2">{r.name}</td>
      <td className="px-3 py-2 font-mono">{r.parent_code ?? ""}</td>
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
}

function ResultsTable({
  imported,
  onReset,
}: {
  imported: OrgBulkImportResponse;
  onReset: () => void;
}) {
  const { results, summary } = imported;
  return (
    <Card>
      <CardHeader
        title="3. Results"
        description={`${summary.created} created · ${summary.updated} updated · ${summary.errors} error`}
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
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Code / #</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {results.map((r) => (
                <tr key={r.row}>
                  <td className="px-3 py-2 text-zinc-500">{r.row}</td>
                  <td className="px-3 py-2">
                    {r.status === "created" && (
                      <Badge tone="success" className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                        Created
                      </Badge>
                    )}
                    {r.status === "updated" && <Badge tone="info">Updated</Badge>}
                    {r.status === "error" && (
                      <Badge tone="danger" className="inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" strokeWidth={2} />
                        Error
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.kind}</td>
                  <td className="px-3 py-2 font-mono">
                    {r.kind === "store" ? r.number ?? "" : r.code ?? ""}
                  </td>
                  <td className="px-3 py-2">{r.name}</td>
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
