// Shared "recent weeks" picker options for the Labor views (Team + By-store).
// This week (latest data) plus the prior ~10 completed fiscal weeks, each keyed
// by its week-ending date so the backend can anchor the rollup on it.

import { fiscalInfo, fiscalWeekRange } from "@/lib/fiscal";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function recentWeekOptions(): { value: string; label: string }[] {
  const fi = fiscalInfo(new Date());
  const cur = fi?.fiscalWeek ?? null;
  const opts = [{ value: "", label: "This week (latest)" }];
  if (!cur) return opts;
  for (let w = cur - 1; w >= Math.max(1, cur - 10); w--) {
    const r = fiscalWeekRange(w);
    if (!r) continue;
    const info = fiscalInfo(r.end);
    opts.push({
      value: ymd(r.end),
      label: `P${info?.period ?? "?"} W${info?.weekInPeriod ?? "?"} · ending ${r.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    });
  }
  return opts;
}
