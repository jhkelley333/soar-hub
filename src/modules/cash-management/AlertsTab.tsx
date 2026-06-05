// Cash Management — Discrepancy Alerts (DO/SDO escalation queue).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Check, Clock, Flag, Lock, User } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { decideAlert, fetchAlerts } from "./api";
import { usd } from "./money";
import { Figure, Pill, StatusPill, severityTone } from "./ui";
import type { CmgAlert } from "./types";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function TimelineRow({
  tone,
  icon: Icon,
  title,
  sub,
  last,
}: {
  tone: "red" | "amber" | "blue" | "green" | "neutral";
  icon: typeof Bell;
  title: string;
  sub: string;
  last?: boolean;
}) {
  const ring = {
    red: "border-red-400 text-red-500",
    amber: "border-amber-400 text-amber-500",
    blue: "border-blue-400 text-blue-500",
    green: "border-emerald-400 text-emerald-500",
    neutral: "border-zinc-300 text-zinc-400",
  }[tone];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={cn("grid h-6 w-6 place-items-center rounded-full border-[1.5px] bg-white", ring)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!last && <div className="w-px flex-1 bg-zinc-200" />}
      </div>
      <div className="pb-4">
        <div className="text-[13px] font-semibold text-midnight">{title}</div>
        <div className="text-xs text-zinc-400">{sub}</div>
      </div>
    </div>
  );
}

export function AlertsTab({ storeId }: { storeId: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: ["cash-alerts", storeId], queryFn: () => fetchAlerts(storeId) });
  const [selId, setSelId] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "acknowledged" | "resolved" }) => decideAlert(id, decision),
    onSuccess: () => {
      toast.push("Alert updated.", "success");
      qc.invalidateQueries({ queryKey: ["cash-alerts"] });
      qc.invalidateQueries({ queryKey: ["cash-overview"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Update failed.", "error"),
  });

  if (query.isLoading) return <Skeleton className="h-80 w-full" />;
  const data = query.data!;
  const alerts = data.alerts;
  const canAct = data.can_act;

  if (alerts.length === 0)
    return (
      <EmptyState title="No discrepancy alerts" description="Closeouts and deposits that breach the tolerance show up here for review." />
    );

  const sel: CmgAlert = alerts.find((a) => a.id === selId) ?? alerts[0];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Discrepancy Alerts</div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-midnight">Variance escalations</h2>
          <p className="mt-1.5 max-w-xl text-sm text-zinc-500">
            Closeouts that breached the tolerance are routed here for DO and SDO review.
          </p>
        </div>
        {!canAct && (
          <Pill tone="neutral" dot>
            Read-only for your role
          </Pill>
        )}
      </div>

      <Card className="mb-5 grid grid-cols-3 divide-x divide-zinc-200">
        <div className="px-5 py-4">
          <Figure label="Open" value={data.counts.open} tone={data.counts.open ? "red" : undefined} mono={false} sub="Need acknowledgement" />
        </div>
        <div className="px-5 py-4">
          <Figure label="Acknowledged" value={data.counts.acknowledged} mono={false} sub="Under review" />
        </div>
        <div className="px-5 py-4">
          <Figure label="Resolved" value={data.counts.resolved} mono={false} sub="Closed out" />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <Card className="overflow-hidden">
          {alerts.map((a, i) => {
            const on = a.id === sel.id;
            return (
              <button
                key={a.id}
                onClick={() => setSelId(a.id)}
                className={cn(
                  "block w-full border-l-[3px] px-4 py-3 text-left transition",
                  i ? "border-t border-t-zinc-100" : "",
                  on ? "border-l-accent bg-zinc-50" : "border-l-transparent hover:bg-zinc-50"
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-zinc-500">#{a.store_number}</span>
                  <StatusPill status={a.status} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-lg font-bold text-red-700">{usd(a.variance_cents, { signed: true })}</span>
                  <span className="text-[13px] capitalize text-zinc-500">{a.type}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-400">{fmtDate(a.created_at)}</div>
              </button>
            );
          })}
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2.5">
                <Pill tone={severityTone(sel.severity)} dot>
                  {sel.severity} severity
                </Pill>
                <StatusPill status={sel.status} />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-midnight">
                {sel.type === "short" ? "Cash short" : "Cash over"} at <span className="font-mono">#{sel.store_number}</span>
              </h3>
              <div className="mt-1 text-[13px] text-zinc-500">
                {fmtDate(sel.created_at)} · {sel.manager_name ?? "—"}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Variance</div>
              <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-red-700">{usd(sel.variance_cents, { signed: true })}</div>
            </div>
          </div>

          <div className="mb-5 rounded-md bg-zinc-50 p-4 ring-1 ring-inset ring-zinc-200">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Manager's note</div>
            <div className="text-sm leading-relaxed text-midnight">{sel.reason ?? "No reason provided."}</div>
          </div>

          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">Escalation timeline</div>
          <div className="mb-5">
            <TimelineRow tone="red" icon={AlertTriangle} title="Variance flagged at closeout" sub={`${fmtDate(sel.created_at)} · auto-detected over tolerance`} />
            <TimelineRow tone="amber" icon={Bell} title={`Notified ${sel.notified.join(" & ") || "DO & SDO"}`} sub="Email + hub alert sent" />
            {(sel.status === "acknowledged" || sel.status === "resolved") && (
              <TimelineRow tone="blue" icon={User} title={`Acknowledged by ${sel.acked_by_name}`} sub="Reviewing drawer + camera" />
            )}
            {sel.status === "resolved" ? (
              <TimelineRow tone="green" icon={Check} title={`Resolved by ${sel.acked_by_name}`} sub="Closed — no further action" last />
            ) : (
              <TimelineRow tone="neutral" icon={Clock} title="Awaiting resolution" sub={sel.status === "open" ? "Not yet acknowledged" : "Pending sign-off"} last />
            )}
          </div>

          {canAct ? (
            <div className="flex flex-wrap gap-3 border-t border-zinc-100 pt-4">
              {sel.status === "open" && (
                <Button variant="secondary" onClick={() => decide.mutate({ id: sel.id, decision: "acknowledged" })} disabled={decide.isPending}>
                  <Check className="h-4 w-4" /> Acknowledge
                </Button>
              )}
              {sel.status !== "resolved" && (
                <Button onClick={() => decide.mutate({ id: sel.id, decision: "resolved" })} disabled={decide.isPending}>
                  <Flag className="h-4 w-4" /> Mark resolved
                </Button>
              )}
              {sel.status === "resolved" && (
                <Pill tone="green" dot>
                  Resolved by {sel.acked_by_name}
                </Pill>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 border-t border-zinc-100 pt-4 text-[13px] text-zinc-500">
              <Lock className="h-3.5 w-3.5" /> Only a DO or SDO can acknowledge or resolve.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
