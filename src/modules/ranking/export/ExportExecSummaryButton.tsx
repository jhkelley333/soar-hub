import { useCallback, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { supabase } from "@/lib/supabase";
import { fetchRankingFull, type RankingRun } from "../api";
import { adaptFullRun } from "./adaptRankerRows";
import { computeExecSummary } from "./computeExecSummary";

/**
 * Turns the loaded ranking run into the single-page executive-summary PDF,
 * entirely client-side. Sits in the Ranker page's run-controls row; disabled
 * until a run is loaded, and hidden for legacy (sheet-era) runs, which don't
 * carry the full metric set the summary needs.
 *
 * The page holds only one scope+tier, so on click we pull the whole run
 * (fetchRankingFull → every tier, both scopes), adapt it, compute, and render.
 * jsPDF + jspdf-autotable are dynamically imported so the ~350 KB only lands
 * when someone actually exports.
 *
 * An export writes an audit row (which run, by whom). A failed audit write is
 * NOT a failed export — the user has the PDF; the error is logged and swallowed.
 */

interface Props {
  run: RankingRun | null;
  /** Set false to skip the audit insert (e.g. local dev). */
  audit?: boolean;
}

export function ExportExecSummaryButton({ run, audit = true }: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onExport = useCallback(async () => {
    if (!run) return;
    setBusy(true);
    const startedAt = performance.now();
    try {
      // Whole run (all tiers, both scopes) — the page only holds one slice.
      const full = await fetchRankingFull(run.id);
      const payload = adaptFullRun(full);
      const summary = computeExecSummary(payload);

      // Lazy-load the PDF stack so jsPDF never ships to the initial bundle.
      const { renderExecSummaryPdf, execSummaryFilename } = await import("./renderExecSummaryPdf");
      const doc = renderExecSummaryPdf(summary);
      const filename = execSummaryFilename(summary);
      doc.save(filename);

      if (audit) {
        const { error: auditError } = await supabase.from("ranking_report_exports").insert({
          run_id: payload.runId,
          report_key: "exec_summary_pdf",
          period_label: payload.periodLabel,
          week_ending: payload.weekEndingISO,
          store_count: payload.storeCount,
          filename,
          data_warnings: summary.dataWarnings,
          render_ms: Math.round(performance.now() - startedAt),
        });
        // A failed audit write must not look like a failed export to the user.
        if (auditError) console.error("exec summary audit insert failed", auditError);
      }
      toast.push(`Executive summary downloaded — ${filename}.`, "success");
    } catch (e) {
      console.error(e);
      toast.push(e instanceof Error ? e.message : "Export failed.", "error");
    } finally {
      setBusy(false);
    }
  }, [run, audit, toast]);

  return (
    <Button variant="secondary" size="sm" onClick={onExport} disabled={!run || busy}
      title="Download the one-page executive summary PDF for this run">
      {busy
        ? <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> Building PDF…</>
        : <><Download className="mr-1 h-3.5 w-3.5" /> Exec summary</>}
    </Button>
  );
}
