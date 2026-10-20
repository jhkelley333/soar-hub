// Printable PAF archive — opens a clean, self-contained HTML document in a new
// window and lets the viewer print / save as PDF. Kept out of the app shell on
// purpose (same pattern as the Talent Review packet) so the printout is a tidy
// landscape table with a letterhead, unaffected by the sidebar/topbar.

import type { PafRow } from "./types";
import { formatUSD } from "./cost";
import { missingAttachment, RETENTION_YEARS, retainUntil } from "./retention";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export interface PafPrintMeta {
  scopeLabel?: string;
  filterLabel?: string;
  preparedBy?: string | null;
}

export function printPafArchive(rows: PafRow[], meta: PafPrintMeta = {}): void {
  const today = new Date().toLocaleString();
  const withAttach = rows.filter((r) => r.nh_offer_letter_path).length;
  const archived = rows.filter((r) => r.archived).length;
  const missing = rows.filter((r) => missingAttachment(r)).length;

  const body = rows
    .map((r) => {
      const store = r.drive_in ?? r.nh_home_store ?? "";
      return `<tr class="${r.archived ? "arch" : ""}">
        <td>${esc(r.created_at.slice(0, 10))}</td>
        <td>${esc(r.pay_period_end)}</td>
        <td>${store ? "#" + esc(store) : "—"}</td>
        <td>${esc(r.employee_name)}</td>
        <td class="mono">${esc(r.last4_ssn)}</td>
        <td>${esc(r.category)}${r.bonus_type ? ` <span class="tag">${esc(r.bonus_type)}</span>` : ""}</td>
        <td class="r">${esc(formatUSD(Number(r.estimated_cost) || 0))}</td>
        <td>${esc(r.status)}${r.archived ? ' <span class="tag">archived</span>' : ""}</td>
        <td class="c">${r.nh_offer_letter_path ? "📎" : missingAttachment(r) ? '<span class="miss">missing</span>' : "—"}</td>
        <td>${esc(r.submitter_email)}</td>
        <td>${esc(r.payroll_processed_by ?? r.approved_by_email ?? "—")}</td>
        <td class="c">${esc(retainUntil(r.created_at))}</td>
      </tr>`;
    })
    .join("");

  const sub = [
    meta.scopeLabel || "All stores",
    `${rows.length} PAF${rows.length === 1 ? "" : "s"}`,
    withAttach ? `${withAttach} with attachment` : null,
    missing ? `${missing} missing required doc` : null,
    archived ? `${archived} archived` : null,
    meta.filterLabel || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PAF Archive</title>
  <style>
    * { box-sizing: border-box; }
    body { font: 11px/1.4 -apple-system, Segoe UI, Roboto, sans-serif; color: #18181b; margin: 28px; }
    h1 { font-size: 19px; margin: 0 0 2px; }
    .sub { color: #71717a; font-size: 11px; margin-bottom: 14px; }
    table { border-collapse: collapse; width: 100%; font-size: 10px; }
    th, td { border: 1px solid #e4e4e7; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #f4f4f5; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; color: #52525b; }
    td.r { text-align: right; } td.c { text-align: center; } td.mono { font-family: ui-monospace, Menlo, monospace; }
    tr.arch { background: #fafafa; color: #71717a; }
    .tag { display: inline-block; background: #f4f4f5; border-radius: 8px; padding: 0 5px; font-size: 8.5px; color: #52525b; }
    .miss { color: #b45309; font-weight: 600; }
    .foot { margin-top: 14px; color: #a1a1aa; font-size: 9px; }
    button { margin-bottom: 14px; padding: 8px 14px; font-size: 13px; font-weight: 600; border: 0; border-radius: 8px; background: #111827; color: #fff; cursor: pointer; }
    @media print { body { margin: 10mm; } button { display: none; } @page { size: landscape; } }
  </style></head><body>
    <button onclick="window.print()">Print / Save as PDF</button>
    <h1>SOAR Hub — PAF Archive</h1>
    <div class="sub">${esc(sub)} · prepared ${esc(today)}${meta.preparedBy ? ` by ${esc(meta.preparedBy)}` : ""}</div>
    <table><thead><tr>
      <th>Submitted</th><th>Pay Period</th><th>Store</th><th>Employee</th><th>SSN</th>
      <th>Category</th><th>Cost</th><th>Status</th><th>Attach</th><th>Submitter</th><th>Approved / Processed By</th><th>Retain Until</th>
    </tr></thead><tbody>${body}</tbody></table>
    <div class="foot">SOAR Hub · PAF Archive. Confidential — contains pay &amp; PII. Legal records retained ${RETENTION_YEARS} years from submission ("Retain Until"). Attachments (offer letters) open from the Hub archive page.</div>
  </body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}
