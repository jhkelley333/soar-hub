// Hours of Operation — bulk import modal. Download a template, upload a CSV or
// .xlsx (or paste), preview the parsed rows (unknown stores flagged), then seed
// standard hours. Mirrors the Bulk Org Import flow.
import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, Upload, FileWarning } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { downloadCSV } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { bulkImportHours } from "./api";
import { hoursTemplateCsv, parseHoursText, parseHoursXlsx, type ParseResult } from "./hoursImport";

export function HoursImportModal({ open, onClose, knownNumbers, onImported }: {
  open: boolean; onClose: () => void; knownNumbers: Set<string>; onImported: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [pasted, setPasted] = useState("");

  const reset = () => { setParsed(null); setFileName(""); setPasted(""); if (fileRef.current) fileRef.current.value = ""; };
  const close = () => { reset(); onClose(); };

  // Split parsed rows into importable (known store) vs unknown-store errors.
  const { valid, unknown } = useMemo(() => {
    const valid = (parsed?.rows ?? []).filter((r) => knownNumbers.has(r.store_number));
    const unknown = (parsed?.rows ?? []).filter((r) => !knownNumbers.has(r.store_number));
    return { valid, unknown };
  }, [parsed, knownNumbers]);

  const onFile = async (file: File) => {
    setFileName(file.name);
    try {
      const res = file.name.toLowerCase().endsWith(".xlsx") ? await parseHoursXlsx(file) : parseHoursText(await file.text());
      setParsed(res);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Couldn't read that file.", "error");
    }
  };

  const runImport = useMutation({
    mutationFn: () => bulkImportHours(valid.map((r) => ({ store_number: r.store_number, days: r.days }))),
    onSuccess: (r) => {
      toast.push(`Imported hours for ${r.imported_stores} location(s).`, "success");
      onImported();
      close();
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Import failed.", "error"),
  });

  return (
    <Modal open={open} onClose={close} title="Upload current hours" maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">{valid.length} ready · {unknown.length} unknown · {parsed?.rowErrors.length ?? 0} skipped</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={() => runImport.mutate()} disabled={!valid.length || runImport.isPending}>
              {runImport.isPending ? "Importing…" : `Import ${valid.length} location(s)`}
            </Button>
          </div>
        </div>
      }
    >
      <p className="mb-3 text-sm text-zinc-500">
        Upload your <strong>Hours of Ops</strong> Excel export (DI Number + Monday…Sunday Open/Close) — it's auto-detected. Or use the
        template below: fill each day's open/close (e.g. <code className="rounded bg-zinc-100 px-1">7:00 AM</code>), put
        <code className="mx-1 rounded bg-zinc-100 px-1">Closed</code> in the day's open cell for a dark day, and leave a day blank to
        keep it unchanged.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => downloadCSV("hours-template.csv", hoursTemplateCsv())}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Download template
        </Button>
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> Choose file (.csv / .xlsx)
        </Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        {fileName && <span className="self-center text-xs text-zinc-500">{fileName}</span>}
      </div>

      {!parsed && (
        <div>
          <div className="mb-1 text-xs font-semibold text-zinc-500">…or paste rows (with the header)</div>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            onBlur={() => pasted.trim() && setParsed(parseHoursText(pasted))}
            rows={4}
            placeholder="store_number,monday_open,monday_close,…"
            className="w-full rounded-lg border border-zinc-200 p-2 font-mono text-xs focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {parsed && (
        <div className="max-h-[46vh] overflow-y-auto rounded-lg ring-1 ring-zinc-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-50 text-left text-[10px] uppercase tracking-wide text-zinc-400">
              <tr><th className="px-3 py-2">Store</th><th className="px-3 py-2">Hours</th><th className="px-3 py-2 text-right">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {valid.map((r) => (
                <tr key={r.store_number}>
                  <td className="px-3 py-2 font-mono font-semibold text-midnight">{r.store_number}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.summary}</td>
                  <td className="px-3 py-2 text-right"><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Ready</span></td>
                </tr>
              ))}
              {unknown.map((r) => (
                <tr key={`u-${r.store_number}`} className="bg-red-50/40">
                  <td className="px-3 py-2 font-mono font-semibold text-red-600">{r.store_number}</td>
                  <td className="px-3 py-2 text-zinc-500">{r.summary}</td>
                  <td className="px-3 py-2 text-right"><span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Unknown store</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(parsed.rowErrors.length > 0) && (
            <div className={cn("flex items-start gap-2 border-t border-zinc-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800")}>
              <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{parsed.rowErrors.length} row(s) skipped: {parsed.rowErrors.slice(0, 4).map((e) => `line ${e.line} (${e.reason})`).join("; ")}{parsed.rowErrors.length > 4 ? "…" : ""}</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
