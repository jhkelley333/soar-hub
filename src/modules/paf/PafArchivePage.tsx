// /paf/archive — Payroll's full PAF archive: every submission ever made
// (archived ones included), searchable, printable, and exportable as a
// complete CSV database dump. Attachments (New Hire offer letters) are
// surfaced per-row with a one-click open. Payroll/Admin only.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  Download,
  Eye,
  Paperclip,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Badge } from "@/shared/ui/Badge";
import { Drawer } from "@/shared/ui/Drawer";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { fetchOfferLetterUrl, listPafArchive } from "./api";
import { PafDetail } from "./PafDetail";
import { applyFilters, QueueFilters, statusCounts, type QueueFilterState } from "./QueueFilters";
import { downloadPafArchiveCsv } from "./csv";
import { printPafArchive } from "./pafPrint";
import { formatUSD } from "./cost";
import { missingAttachment, RETENTION_YEARS, retainUntil, retentionMet } from "./retention";
import type { PafRow, PafStatus } from "./types";

const STATUS_TONE: Record<PafStatus, "neutral" | "warning" | "info" | "success" | "danger"> = {
  Pending: "warning",
  "Pending SDO Approval": "warning",
  "Pending VP Approval": "warning",
  Approved: "info",
  Rejected: "danger",
  "Needs Approval": "warning",
  "Needs Info": "warning",
  Processed: "success",
};

type SortKey = "created_at" | "pay_period_end" | "drive_in" | "employee_name" | "category" | "estimated_cost" | "status";
type SortDir = "asc" | "desc";
type DateField = "created_at" | "pay_period_end";

function sortValue(row: PafRow, key: SortKey): string | number {
  switch (key) {
    case "created_at": return row.created_at;
    case "pay_period_end": return row.pay_period_end ?? "";
    case "drive_in": return row.drive_in ?? row.nh_home_store ?? "";
    case "employee_name": return row.employee_name.toLowerCase();
    case "category": return row.category;
    case "estimated_cost": return Number(row.estimated_cost) || 0;
    case "status": return row.status;
  }
}

export function PafArchivePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [filters, setFilters] = useState<QueueFilterState>({ status: "ALL", query: "" });
  const [dateField, setDateField] = useState<DateField>("created_at");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [attachOnly, setAttachOnly] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [detail, setDetail] = useState<PafRow | null>(null);

  const query = useQuery({ queryKey: ["paf-archive"], queryFn: listPafArchive });
  const allRows = query.data?.pafs ?? [];

  // Status chips + search reuse the shared queue filter; then layer on the
  // archive-only controls (archived toggle, attachment toggle, date window).
  const filtered = useMemo(() => {
    let rows = applyFilters(allRows, filters);
    if (!includeArchived) rows = rows.filter((r) => !r.archived);
    if (attachOnly) rows = rows.filter((r) => !!r.nh_offer_letter_path);
    if (missingOnly) rows = rows.filter((r) => missingAttachment(r));
    if (from) rows = rows.filter((r) => (r[dateField] ?? "").slice(0, 10) >= from);
    if (to) rows = rows.filter((r) => (r[dateField] ?? "").slice(0, 10) <= to);
    return rows;
  }, [allRows, filters, includeArchived, attachOnly, missingOnly, from, to, dateField]);

  const counts = useMemo(() => statusCounts(allRows), [allRows]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const attachCount = useMemo(() => allRows.filter((r) => r.nh_offer_letter_path).length, [allRows]);
  const archivedCount = useMemo(() => allRows.filter((r) => r.archived).length, [allRows]);
  const missingCount = useMemo(() => allRows.filter((r) => missingAttachment(r)).length, [allRows]);

  function clickSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir(key === "estimated_cost" || key === "created_at" || key === "pay_period_end" ? "desc" : "asc");
    }
  }

  async function openAttachment(p: PafRow) {
    try {
      const { url } = await fetchOfferLetterUrl(p.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Couldn't open attachment.", "error");
    }
  }

  const filterLabel = useMemo(() => {
    const bits: string[] = [];
    if (filters.status !== "ALL") bits.push(filters.status);
    if (filters.query) bits.push(`"${filters.query}"`);
    if (attachOnly) bits.push("with attachment");
    if (missingOnly) bits.push("missing required doc");
    if (from || to) bits.push(`${dateField === "created_at" ? "submitted" : "pay period"} ${from || "…"}–${to || "…"}`);
    if (!includeArchived) bits.push("active only");
    return bits.join(", ");
  }, [filters, attachOnly, missingOnly, from, to, dateField, includeArchived]);

  if (query.isLoading) {
    return (
      <>
        <PageHeader title="PAF Archive" description="Loading the full record…" />
        <Skeleton className="h-32 w-full" />
      </>
    );
  }

  if (query.isError || !query.data) {
    return (
      <>
        <PageHeader title="PAF Archive" />
        <EmptyState
          title="Couldn't load the archive"
          description={(query.error as Error)?.message ?? "Try again."}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="PAF Archive"
        description={`${allRows.length} total · ${attachCount} with attachment · ${missingCount} missing required doc · ${archivedCount} archived`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/paf/queue")}>
              <ChevronLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Queue
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => printPafArchive(sorted, { filterLabel, preparedBy: profile?.full_name ?? profile?.email ?? null })}
              disabled={sorted.length === 0}
            >
              <Printer className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Print
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadPafArchiveCsv(sorted)}
              disabled={sorted.length === 0}
            >
              <Download className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Export CSV
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-accent/5 px-3 py-2 text-xs text-zinc-600 ring-1 ring-accent/10">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
        <span>
          <span className="font-semibold text-midnight">Legal retention — {RETENTION_YEARS} years.</span>{" "}
          PAFs and their attachments are kept {RETENTION_YEARS} years from submission ("Retain until"). "Delete" in
          the queue archives a PAF — it stays in this record and is never destroyed.
        </span>
        {missingCount > 0 && (
          <button
            type="button"
            onClick={() => setMissingOnly(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
          >
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            {missingCount} missing a required document
          </button>
        )}
      </div>

      <Card>
        <div className="space-y-3 p-3">
          <QueueFilters state={filters} onChange={setFilters} counts={counts} />

          {/* Archive-only controls: date window + attachment / archived toggles */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
            <label className="flex items-center gap-1.5">
              <span className="font-medium">Date</span>
              <select
                value={dateField}
                onChange={(e) => setDateField(e.target.value as DateField)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-midnight focus:border-accent focus:outline-none"
              >
                <option value="created_at">Submitted</option>
                <option value="pay_period_end">Pay period</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span>From</span>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[9.5rem] py-1 text-xs" />
            </label>
            <label className="flex items-center gap-1.5">
              <span>To</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[9.5rem] py-1 text-xs" />
            </label>
            {(from || to) && (
              <button
                type="button"
                onClick={() => { setFrom(""); setTo(""); }}
                className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-midnight"
              >
                Clear dates
              </button>
            )}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={attachOnly} onChange={(e) => setAttachOnly(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
              Has attachment
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
              Missing required doc
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
              Include archived
            </label>
            <span className="ml-auto tabular-nums text-zinc-400">
              Showing {sorted.length} of {allRows.length}
            </span>
          </div>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            title="No PAFs match"
            description="Try a different status, search, or date window."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 text-left text-zinc-500">
                <tr>
                  <SortableTh label="Submitted" k="created_at" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <SortableTh label="Pay Period" k="pay_period_end" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <SortableTh label="Store" k="drive_in" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <SortableTh label="Employee" k="employee_name" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <th className="px-3 py-2 font-medium">SSN</th>
                  <SortableTh label="Category" k="category" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <SortableTh label="Cost" k="estimated_cost" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <SortableTh label="Status" k="status" active={sortKey} dir={sortDir} onClick={clickSort} />
                  <th className="px-3 py-2 font-medium">Attach</th>
                  <th className="px-3 py-2 font-medium">Submitter</th>
                  <th className="px-3 py-2 font-medium">Retain until</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((p) => (
                  <tr key={p.id} className={cn(p.archived && "bg-zinc-50/60 text-zinc-500")}>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{p.created_at.slice(0, 10)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">{p.pay_period_end}</td>
                    <td className="px-3 py-2 font-mono text-midnight">
                      {p.drive_in ? `#${p.drive_in}` : p.nh_home_store ? `#${p.nh_home_store}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        {p.employee_name}
                        {p.archived && (
                          <span className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">archived</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{p.last4_ssn}</td>
                    <td className="px-3 py-2 text-zinc-600">{p.category}</td>
                    <td className="px-3 py-2 tabular-nums">{formatUSD(Number(p.estimated_cost) || 0)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {p.nh_offer_letter_path ? (
                        <button
                          type="button"
                          onClick={() => openAttachment(p)}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-accent hover:bg-accent/5"
                          title="Open offer letter"
                        >
                          <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
                          View
                        </button>
                      ) : missingAttachment(p) ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"
                          title="This category requires a signed offer letter, but none is on file"
                        >
                          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                          missing
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">{p.submitter_email}</td>
                    <td
                      className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-500"
                      title={retentionMet(p.created_at) ? "Retention window met" : `Under ${RETENTION_YEARS}-year legal retention`}
                    >
                      {retainUntil(p.created_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDetail(p)}>
                        <Eye className="mr-1 h-3 w-3" strokeWidth={1.75} />
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `PAF — ${detail.employee_name}` : ""}
        footer={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            {detail?.nh_offer_letter_path && (
              <Button variant="secondary" onClick={() => openAttachment(detail)}>
                <Paperclip className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Open attachment
              </Button>
            )}
          </div>
        }
      >
        {detail && <PafDetail paf={detail} />}
      </Drawer>
    </>
  );
}

function SortableTh({
  label,
  k,
  active,
  dir,
  onClick,
}: {
  label: string;
  k: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const isActive = active === k;
  const Icon = !isActive ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onClick(k)}
        className={cn("inline-flex items-center gap-1 transition hover:text-midnight", isActive && "text-midnight")}
      >
        {label}
        <Icon className={cn("h-3 w-3", isActive ? "opacity-100" : "opacity-30")} strokeWidth={2} />
      </button>
    </th>
  );
}
