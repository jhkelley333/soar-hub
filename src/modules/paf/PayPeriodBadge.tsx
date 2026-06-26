// Shows the current biweekly pay period (cycle A or B) derived from the SOAR
// fiscal calendar, with the period-end and payday for context. Rendered on the
// PAF screens so submitters/payroll always see which period they're in.
import { CalendarClock } from "lucide-react";
import { currentPayPeriod } from "@/lib/fiscal";
import { cn } from "@/lib/cn";

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function PayPeriodBadge({ className }: { className?: string }) {
  const { cycle, periodStart, periodEnd, payday } = currentPayPeriod();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent",
        className,
      )}
      title={`Pay period ${cycle} · ${fmt(periodStart)} – ${fmt(periodEnd)} · pays ${fmt(payday)}`}
    >
      <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
      <span className="font-semibold">Pay period {cycle}</span>
      <span className="font-normal text-accent/70">ended {fmt(periodEnd)} · pays {fmt(payday)}</span>
    </span>
  );
}
