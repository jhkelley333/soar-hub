// Reusable PAF table. Used by /paf history and /paf/queue. Action set
// varies by caller — "view" renders a Detail button only; "process"
// adds Reject / Needs Approval / Mark Processed buttons.

import { useState } from "react";
import { Eye } from "lucide-react";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { ProcessActions } from "./ProcessActions";
import { SdoActions } from "./SdoActions";
import { PafDetail } from "./PafDetail";
import type { PafRow, PafStatus } from "./types";
import { formatUSD } from "./cost";

const STATUS_TONE: Record<PafStatus, "neutral" | "warning" | "info" | "success" | "danger"> = {
  Pending: "warning",
  "Pending SDO Approval": "warning",
  Approved: "info",
  Rejected: "danger",
  "Needs Approval": "warning",
  "Needs Info": "warning",
  Processed: "success",
};

export function PafTable({
  rows,
  actions,
}: {
  rows: PafRow[];
  actions: "view" | "process" | "sdo";
}) {
  const [detail, setDetail] = useState<PafRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Store</th>
              <th className="px-3 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">SSN</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Cost</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-600">
                  {p.created_at.slice(0, 10)}
                </td>
                <td className="px-3 py-2 font-mono text-midnight">#{p.drive_in}</td>
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

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `PAF — ${detail.employee_name}` : ""}
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && <PafDetail paf={detail} />}
      </Modal>
    </>
  );
}
