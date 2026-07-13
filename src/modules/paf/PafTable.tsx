// Reusable PAF table. Used by /paf history, /paf/queue, and the SDO
// dashboard widget. Action set varies by caller. Columns are sortable
// (click headers); newest-first is the default.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Bell, Eye, Pencil } from "lucide-react";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Drawer } from "@/shared/ui/Drawer";
import { useAuth } from "@/auth/AuthProvider";
import { useFlag } from "@/lib/flags";
import { fetchPafUnread, markThreadRead } from "@/modules/chat/api";
import { ProcessActions } from "./ProcessActions";
import { SdoActions } from "./SdoActions";
import { DeletePafAction } from "./DeletePafAction";
import { TextApproverAction } from "./TextApproverAction";
import { PafDetail } from "./PafDetail";
import type { PafRow, PafStatus } from "./types";
import { formatUSD } from "./cost";
import { cn } from "@/lib/cn";

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

type SortKey =
  | "created_at"
  | "drive_in"
  | "employee_name"
  | "category"
  | "estimated_cost"
  | "status";
type SortDir = "asc" | "desc";

function sortValue(row: PafRow, key: SortKey): string | number {
  switch (key) {
    case "created_at":
      return row.created_at;
    case "drive_in":
      return row.drive_in ?? row.nh_home_store ?? "";
    case "employee_name":
      return row.employee_name.toLowerCase();
    case "category":
      return row.category;
    case "estimated_cost":
      return Number(row.estimated_cost) || 0;
    case "status":
      return row.status;
  }
}

function cmp(a: string | number, b: string | number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Can this viewer approve/reject the PAF? The assigned approver always; plus a
// role senior to the tier (RVP+ on a bonus SDO review, VP+ on a pay-adjustment
// VP review). The list is already scope-filtered, so seeing a pending PAF
// implies reach — the server re-checks scope on the action.
function canApprove(
  paf: PafRow,
  profile: { id?: string; role?: string } | null | undefined,
): boolean {
  if (!profile) return false;
  const isVpFlow = paf.status === "Pending VP Approval";
  if (paf.status !== "Pending SDO Approval" && !isVpFlow) return false;
  if (profile.role === "admin") return true;
  if (paf.sdo_approver_id && paf.sdo_approver_id === profile.id) return true;
  const escalate = isVpFlow ? ["vp", "coo"] : ["rvp", "vp", "coo"];
  return escalate.includes(profile.role ?? "");
}

export function PafTable({
  rows,
  actions,
  onEdit,
}: {
  rows: PafRow[];
  actions: "view" | "process" | "sdo";
  // When provided, a rejected PAF the viewer submitted shows an
  // "Edit & resubmit" action in the detail drawer.
  onEdit?: (paf: PafRow) => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  // Behind a feature flag until Telnyx is fully set up. Server re-checks.
  const textApproverOn = useFlag("paf_text_approver");
  // The owner can always edit & resubmit their own; an SDO/RVP and above can
  // resubmit on a submitter's behalf (the list is already scope-filtered, so
  // anything they can see here is in their scope). Server re-checks.
  const onBehalfRoles = ["sdo", "rvp", "vp", "coo", "admin"];
  // Editable while rejected (the original flow) or still pending a decision.
  const editableStatuses = ["Rejected", "Pending", "Pending SDO Approval", "Pending VP Approval"];
  const canEditResubmit = (p: PafRow) =>
    !!onEdit &&
    editableStatuses.includes(p.status) &&
    (p.submitter_id === profile?.id || onBehalfRoles.includes(profile?.role ?? ""));
  // Admins can delete any PAF; the submitter can delete their own while pending.
  const pendingStatuses = ["Pending", "Pending SDO Approval", "Pending VP Approval"];
  const canDelete = (p: PafRow) =>
    isAdmin || (p.submitter_id === profile?.id && pendingStatuses.includes(p.status));
  // A heads-up text only makes sense while the PAF is still awaiting its
  // assigned approver. Same audience as edit/delete (submitter or on-behalf
  // roles); server re-checks role + that an approver phone is on file.
  const canText = (p: PafRow) =>
    textApproverOn &&
    pendingStatuses.includes(p.status) &&
    !!p.sdo_approver_id &&
    (p.submitter_id === profile?.id || onBehalfRoles.includes(profile?.role ?? ""));
  const [detail, setDetail] = useState<PafRow | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const qc = useQueryClient();

  // Bell badge: which rows have an unread PAF-discussion message for me.
  // Cleared the moment the row's details are opened (below), even if the
  // viewer never actually opens the chat thread itself.
  const pafIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const unreadQ = useQuery({
    queryKey: ["paf-unread", pafIds],
    queryFn: () => fetchPafUnread(pafIds),
    enabled: pafIds.length > 0,
    staleTime: 30_000,
  });
  const byPaf = unreadQ.data?.byPaf ?? {};

  function openDetail(p: PafRow) {
    setDetail(p);
    const entry = byPaf[p.id];
    if (entry && entry.unread > 0) {
      markThreadRead(entry.threadId)
        .then(() => qc.invalidateQueries({ queryKey: ["paf-unread"] }))
        .catch(() => {});
    }
  }

  function clickSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Cost defaults to descending (biggest first); everything else
      // ascending. Created_at also descending (newest first).
      setSortDir(key === "estimated_cost" || key === "created_at" ? "desc" : "asc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const c = cmp(sortValue(a, sortKey), sortValue(b, sortKey));
      return sortDir === "asc" ? c : -c;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <SortableTh
                label="Date"
                sortKey="created_at"
                active={sortKey}
                dir={sortDir}
                onClick={clickSort}
              />
              <SortableTh
                label="Store"
                sortKey="drive_in"
                active={sortKey}
                dir={sortDir}
                onClick={clickSort}
              />
              <SortableTh
                label="Employee"
                sortKey="employee_name"
                active={sortKey}
                dir={sortDir}
                onClick={clickSort}
              />
              <th className="px-3 py-2 font-medium">SSN</th>
              <SortableTh
                label="Category"
                sortKey="category"
                active={sortKey}
                dir={sortDir}
                onClick={clickSort}
              />
              <SortableTh
                label="Cost"
                sortKey="estimated_cost"
                active={sortKey}
                dir={sortDir}
                onClick={clickSort}
              />
              <SortableTh
                label="Status"
                sortKey="status"
                active={sortKey}
                dir={sortDir}
                onClick={clickSort}
              />
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                  {p.created_at.slice(0, 10)}
                </td>
                <td className="px-3 py-2 font-mono text-midnight">
                  {p.drive_in
                    ? `#${p.drive_in}`
                    : p.nh_home_store
                      ? `#${p.nh_home_store}`
                      : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {p.employee_name}
                    {byPaf[p.id]?.unread > 0 && (
                      <Bell
                        className="h-3 w-3 shrink-0 text-cherry"
                        strokeWidth={2}
                        aria-label="Unread message on this PAF's discussion"
                      />
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{p.last4_ssn}</td>
                <td className="px-3 py-2 text-zinc-600">{p.category}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatUSD(Number(p.estimated_cost) || 0)}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>
                      {p.status}
                    </Badge>
                    {p.late_for_week && (
                      <span
                        className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200"
                        title={`Submitted after the weekly cutoff — processes with the week of ${p.process_week ?? "next week"}`}
                      >
                        Late — next wk
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetail(p)}
                    >
                      <Eye className="mr-1 h-3 w-3" strokeWidth={1.75} />
                      Detail
                    </Button>
                    {actions === "process" && <ProcessActions paf={p} />}
                    {actions === "sdo" && <SdoActions paf={p} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `PAF — ${detail.employee_name}` : ""}
        footer={
          <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Close
              </Button>
              {detail && canEditResubmit(detail) && (
                <Button
                  onClick={() => {
                    const p = detail;
                    setDetail(null);
                    onEdit?.(p);
                  }}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
                  {detail.status === "Rejected" ? "Edit & resubmit" : "Edit"}
                </Button>
              )}
              {detail && canText(detail) && <TextApproverAction paf={detail} />}
              {detail && canDelete(detail) && (
                <DeletePafAction paf={detail} onComplete={() => setDetail(null)} />
              )}
            </div>
            {detail && actions === "process" && (
              <div className="flex flex-wrap items-center gap-1.5">
                <ProcessActions
                  paf={detail}
                  onComplete={() => setDetail(null)}
                />
              </div>
            )}
            {detail && canApprove(detail, profile) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <SdoActions
                  paf={detail}
                  onComplete={() => setDetail(null)}
                />
              </div>
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
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onClick: (key: SortKey) => void;
}) {
  const isActive = active === sortKey;
  const Icon = !isActive ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 transition hover:text-midnight",
          isActive && "text-midnight"
        )}
      >
        {label}
        <Icon
          className={cn(
            "h-3 w-3",
            isActive ? "opacity-100" : "opacity-30"
          )}
          strokeWidth={2}
        />
      </button>
    </th>
  );
}
