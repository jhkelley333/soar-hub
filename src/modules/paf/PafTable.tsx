// Reusable PAF table. Used by /paf history, /paf/queue, and the SDO
// dashboard widget. Action set varies by caller. Columns are sortable
// (click headers); newest-first is the default.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye, Pencil } from "lucide-react";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Drawer } from "@/shared/ui/Drawer";
import { useAuth } from "@/auth/AuthProvider";
import { ProcessActions } from "./ProcessActions";
import { SdoActions } from "./SdoActions";
import { DeletePafAction } from "./DeletePafAction";
import { PafDetail } from "./PafDetail";
import type { PafRow, PafStatus } from "./types";
import { formatUSD } from "./cost";
import { cn } from "@/lib/cn";

const STATUS_TONE: Record<PafStatus, "neutral" | "warning" | "info" | "success" | "danger"> = {
  Pending: "warning",
  "Pending SDO Approval": "warning",
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
  const canEditResubmit = (p: PafRow) =>
    !!onEdit && p.status === "Rejected" && p.submitter_id === profile?.id;
  const [detail, setDetail] = useState<PafRow | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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
                <td className="px-3 py-2">{p.employee_name}</td>
                <td className="px-3 py-2 font-mono">{p.last4_ssn}</td>
                <td className="px-3 py-2 text-zinc-600">{p.category}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatUSD(Number(p.estimated_cost) || 0)}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>
                    {p.status}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDetail(p)}
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
                  Edit & resubmit
                </Button>
              )}
              {detail && isAdmin && (
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
            {detail && actions === "sdo" && (
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
