// Cash Management — Dashboard: tonight's status cards + recent closeouts.

import { AlertTriangle, ArrowRight, Banknote, Moon, type LucideIcon } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { cn } from "@/lib/cn";
import type { Overview } from "./types";
import { usd } from "./money";
import { Pill, StatusPill } from "./ui";

type Tone = "green" | "amber" | "red" | "neutral";
const RING: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
  neutral: "bg-zinc-100 text-zinc-500",
};
const CTA: Record<Tone, string> = {
  green: "text-emerald-700",
  amber: "text-amber-700",
  red: "text-red-700",
  neutral: "text-zinc-500",
};

function StatusCard({
  icon: Icon,
  tone,
  kicker,
  title,
  body,
  foot,
  cta,
  onClick,
}: {
  icon: LucideIcon;
  tone: Tone;
  kicker: string;
  title: string;
  body: string;
  foot: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[168px] flex-col gap-3.5 rounded-lg border border-zinc-200 bg-white p-5 text-left transition hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <div className={cn("grid h-10 w-10 place-items-center rounded-[10px]", RING[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <Pill tone={tone} dot>
          {kicker}
        </Pill>
      </div>
      <div className="flex-1">
        <div className="text-[17px] font-bold tracking-tight text-midnight">{title}</div>
        <div className="mt-1 text-[13px] leading-snug text-zinc-500">{body}</div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-zinc-400">{foot}</div>
        <span className={cn("inline-flex items-center gap-1 text-[13px] font-bold", CTA[tone])}>
          {cta}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

export function DashboardTab({ overview, onNav }: { overview: Overview; onNav: (t: "closeout" | "deposit" | "alerts" | "dsr") => void }) {
  const { store, closeout, pending_deposit, open_alerts, history } = overview;
  const tol = overview.toleranceCents;

  const coCard =
    closeout && closeout.status !== undefined
      ? {
          tone: (closeout.flagged ? "red" : "green") as Tone,
          kicker: closeout.flagged ? "Flagged" : "Submitted",
          title: closeout.flagged ? "Closeout submitted — variance flagged" : "Tonight's closeout is in",
          body: `Deposit ${usd(closeout.deposit_cents)} recorded against ${usd(closeout.cash_due_cents)} due.`,
          foot: `Variance ${usd(closeout.variance_cents, { signed: true })}`,
          cta: "View summary",
        }
      : {
          tone: "amber" as Tone,
          kicker: "Action needed",
          title: "Run tonight's closeout",
          body: `Count the drawer, log the deposit, and clear ${store?.name ?? "the store"} for the night.`,
          foot: "Reconcile against the DSR",
          cta: "Start closeout",
        };

  const depCard = pending_deposit
    ? {
        tone: "amber" as Tone,
        kicker: "Awaiting validation",
        title: "Validate next-day deposit",
        body: "Confirm the bank credit and attach the deposit-slip photo before the cutoff.",
        foot: `${usd(pending_deposit.expected_cents)} expected`,
        cta: "Validate now",
      }
    : {
        tone: "green" as Tone,
        kicker: "All clear",
        title: "No deposit awaiting validation",
        body: "Every deposit on file has been confirmed at the bank.",
        foot: "Nothing pending",
        cta: "History",
      };

  return (
    <div>
      <div className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
          {overview.business_date} · {store?.name ?? `Store ${store?.number}`}
        </div>
        <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-midnight">
          {closeout && pending_deposit === null ? "All clear for the cycle." : "You have open items in tonight's cash cycle."}
        </h2>
      </div>

      <div className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatusCard icon={Moon} {...coCard} onClick={() => onNav("closeout")} />
        <StatusCard icon={Banknote} {...depCard} onClick={() => onNav("deposit")} />
        <StatusCard
          icon={AlertTriangle}
          tone={open_alerts ? "red" : "neutral"}
          kicker={open_alerts ? `${open_alerts} open` : "All clear"}
          title={open_alerts ? `${open_alerts} discrepancy alert${open_alerts > 1 ? "s" : ""}` : "No open discrepancies"}
          body={
            open_alerts
              ? `Variances over the ${usd(tol)} tolerance routed to DO & SDO for review.`
              : "Every flagged variance has been acknowledged or resolved."
          }
          foot={`${usd(tol)} tolerance`}
          cta={open_alerts ? "Review" : "History"}
          onClick={() => onNav("alerts")}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-midnight">Recent closeouts</div>
            <div className="mt-0.5 text-xs text-zinc-500">Last {history.length} business days</div>
          </div>
          <button onClick={() => onNav("dsr")} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-midnight">
            Full DSR <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {history.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-zinc-400">No closeouts yet — run tonight's to start the ledger.</div>
        ) : (
          <>
            <table className="hidden w-full text-sm sm:table">
              <thead className="text-left text-[11px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-5 py-3 font-bold">Closeout</th>
                <th className="px-4 py-3 text-right font-bold">Cash due</th>
                <th className="px-4 py-3 text-right font-bold">Deposit</th>
                <th className="px-4 py-3 text-right font-bold">Variance</th>
                <th className="px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const over = Math.abs(h.variance_cents) > tol;
                return (
                  <tr key={h.closeout_id} className="border-t border-zinc-100">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-midnight">{h.business_date.slice(5)}</span>
                        {h.is_late && <Pill tone="red">Late</Pill>}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-400">{h.id}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{usd(h.cash_due_cents)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{usd(h.deposit_cents)}</td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-bold tabular-nums",
                        h.variance_cents === 0 ? "text-zinc-400" : over ? "text-red-700" : "text-zinc-600"
                      )}
                    >
                      {h.variance_cents === 0 ? "—" : usd(h.variance_cents, { signed: true })}
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill status={h.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>

            <ul className="divide-y divide-zinc-100 sm:hidden">
              {history.map((h) => {
                const over = Math.abs(h.variance_cents) > tol;
                return (
                  <li key={h.closeout_id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-midnight">{h.business_date.slice(5)}</span>
                          {h.is_late && <Pill tone="red">Late</Pill>}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-400">{h.id}</div>
                      </div>
                      <StatusPill status={h.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[13px]">
                      <span className="text-zinc-500">
                        Deposit <span className="font-semibold tabular-nums text-midnight">{usd(h.deposit_cents)}</span>
                      </span>
                      <span className={cn("font-bold tabular-nums", h.variance_cents === 0 ? "text-zinc-400" : over ? "text-red-700" : "text-zinc-600")}>
                        {h.variance_cents === 0 ? "—" : usd(h.variance_cents, { signed: true })}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
