// Weekly Labor Miss Tracker export — button + week-picker modal + CSV
// download. Shared by legacy District labor and Labor v2 Team labor; each
// passes its own fetcher (labor vs labor-v2 miss-tracker endpoint).

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { toCSV, downloadCSV } from "@/lib/csv";
import type { MissTrackerResponse } from "@/modules/labor-v2/api";

// Last N week-start Mondays (current week first) as ISO dates.
function recentMondays(n: number): string[] {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back up to Monday
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d);
    m.setDate(d.getDate() - i * 7);
    return m.toLocaleDateString("en-CA");
  });
}

function fmtWeekLabel(monday: string): string {
  const mon = new Date(`${monday}T12:00:00`);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const f = (dt: Date) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Mon ${f(mon)} – Sun ${f(sun)}`;
}

export function MissTrackerExport({ fetcher }: { fetcher: (weekStart: string) => Promise<MissTrackerResponse> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState<string>(() => recentMondays(1)[0]);
  const [busy, setBusy] = useState(false);
  const mondays = useMemo(() => recentMondays(12), []);

  // Columns mirror the paper tracker: store, weekly total, hours missed by
  // day (Mon–Sun), then the filed explanation by day.
  async function exportCsv() {
    setBusy(true);
    try {
      const res = await fetcher(week);
      if (!res.rows.length) {
        toast.push(`No stores missed labor by more than ${res.threshold} hours that week.`, "info");
        return;
      }
      const dayNames = res.week.map((d) =>
        new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }));
      const headers = [
        "Store #", "Store", "Weekly Total Miss (Hrs)",
        ...dayNames.map((n) => `${n} (Hrs)`),
        ...dayNames.map((n) => `${n} Explanation`),
      ];
      const csvRows = res.rows.map((r) => {
        const row: Record<string, unknown> = {
          "Store #": r.store_number,
          "Store": r.store_name ?? "",
          "Weekly Total Miss (Hrs)": r.total,
        };
        res.week.forEach((d, i) => {
          row[`${dayNames[i]} (Hrs)`] = r.days[d] ?? "";
          row[`${dayNames[i]} Explanation`] = r.explanations[d] ?? "";
        });
        return row;
      });
      downloadCSV(`labor-miss-tracker-${week}.csv`, toCSV(headers, csvRows));
      toast.push(`Downloaded — ${res.rows.length} store${res.rows.length === 1 ? "" : "s"} over ${res.threshold} hrs.`, "success");
      setOpen(false);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Export failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Download className="mr-1 h-3.5 w-3.5" /> Miss tracker
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Weekly Labor Miss Tracker"
        footer={
          <Button size="sm" onClick={exportCsv} disabled={busy}>
            <Download className={cn("mr-1 h-3.5 w-3.5", busy && "animate-pulse")} />
            {busy ? "Building…" : "Download CSV"}
          </Button>
        }>
        <p className="mb-3 text-xs text-zinc-500">
          Stores that missed labor by more than 7 hours in the chosen week — hours missed by day, with the root cause
          and explanation the GM filed. Opens in Excel or Google Sheets.
        </p>
        <label className="mb-1 block text-xs font-semibold text-zinc-600">Week</label>
        <select
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className="w-full rounded-lg border-0 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          {mondays.map((m, i) => (
            <option key={m} value={m}>
              {fmtWeekLabel(m)}{i === 0 ? " (this week)" : i === 1 ? " (last week)" : ""}
            </option>
          ))}
        </select>
      </Modal>
    </>
  );
}
