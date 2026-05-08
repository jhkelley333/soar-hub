// Dashboard widget — "Birthdays This Week and Next."
// Groups entries by RVP (region) so the structure scans like an org
// chart slice. Empty state when nobody in scope has a birthday in
// the 14-day window.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CakeSlice } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { fetchBirthdays } from "./api";
import {
  formatMonthDay,
  isToday,
  isTomorrow,
  thisAndNextWeekRange,
} from "./dateRange";
import type { BirthdayEntry } from "./types";

export function BirthdayWidget() {
  const range = useMemo(() => thisAndNextWeekRange(), []);
  const query = useQuery({
    queryKey: ["birthdays", range.start, range.end],
    queryFn: () => fetchBirthdays(range.start, range.end),
    staleTime: 5 * 60_000,
  });

  const groups = useMemo(() => {
    const entries = query.data?.entries ?? [];
    const byRvp = new Map<string, { rvpName: string; regionName: string | null; entries: BirthdayEntry[] }>();
    for (const e of entries) {
      const key = e.rvp_id ?? e.region_id ?? "_unassigned";
      const rvpName = e.rvp_name ?? "Region lead unassigned";
      const existing = byRvp.get(key);
      if (existing) existing.entries.push(e);
      else byRvp.set(key, { rvpName, regionName: e.region_name, entries: [e] });
    }
    return Array.from(byRvp.values()).sort((a, b) => a.rvpName.localeCompare(b.rvpName));
  }, [query.data]);

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <CakeSlice className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
            Birthdays This Week and Next
          </span>
        }
        description="Two-week look-ahead for your team."
      />
      <CardBody>
        {query.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : query.isError ? (
          <div className="text-sm text-red-700">
            {(query.error as Error)?.message ?? "Couldn't load birthdays."}
          </div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-zinc-500">
            No birthdays in your view this week or next.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((g, i) => (
              <div key={i}>
                <div className="text-xs font-semibold uppercase tracking-wide text-midnight">
                  {g.rvpName}
                  {g.regionName && (
                    <span className="ml-2 text-[10px] font-normal text-zinc-500">
                      {g.regionName}
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {g.entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-midnight">{e.name}</span>
                      <Badge tone="info">
                        {ROLE_LABELS[e.role as UserRole] ?? e.role}
                      </Badge>
                      {e.store_number && (
                        <span className="text-xs text-zinc-500">
                          Store #{e.store_number}
                        </span>
                      )}
                      <span className="text-xs text-zinc-500">
                        {formatMonthDay(e.birthday)}
                      </span>
                      {isToday(e.birthday) && (
                        <Badge tone="success">Today 🎂</Badge>
                      )}
                      {isTomorrow(e.birthday) && (
                        <Badge tone="warning">Tomorrow</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
