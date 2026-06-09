// Nested area → district → store filter for the Schedule. Checkboxes toggle
// which stores' events are shown. Operates on a Set of active store NUMBERS
// (events carry store_number); the parent owns the set.
import { useMemo } from "react";
import type { AreaGroup } from "./types";

export function OrgTreeFilter({
  tree,
  active,
  onChange,
}: {
  tree: AreaGroup[];
  active: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allNums = useMemo(
    () => tree.flatMap((a) => a.districts.flatMap((d) => d.stores.map((s) => s.number))),
    [tree]
  );
  const allOn = allNums.length > 0 && allNums.every((n) => active.has(n));

  function setMany(nums: string[], on: boolean) {
    const next = new Set(active);
    for (const n of nums) on ? next.add(n) : next.delete(n);
    onChange(next);
  }

  if (tree.length === 0) return null;

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Stores</span>
        <button onClick={() => setMany(allNums, !allOn)} className="text-xs font-medium text-accent hover:underline">
          {allOn ? "Clear" : "All"}
        </button>
      </div>
      <div className="space-y-3">
        {tree.map((area) => (
          <div key={area.area_id ?? "none"}>
            {area.area_name && (
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{area.area_name}</div>
            )}
            <div className="space-y-1.5">
              {area.districts.map((d) => {
                const nums = d.stores.map((s) => s.number);
                const dAll = nums.length > 0 && nums.every((n) => active.has(n));
                const dSome = nums.some((n) => active.has(n));
                return (
                  <div key={d.district_id ?? "none"}>
                    <label className="flex items-center gap-2 px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={dAll}
                        ref={(el) => { if (el) el.indeterminate = !dAll && dSome; }}
                        onChange={() => setMany(nums, !dAll)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 text-accent focus:ring-accent"
                      />
                      <span className="font-medium text-midnight">
                        {d.district_name || "Stores"}{d.district_code ? ` · ${d.district_code}` : ""}
                      </span>
                    </label>
                    <div className="ml-5 space-y-0.5">
                      {d.stores.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 px-1 py-0.5">
                          <input
                            type="checkbox"
                            checked={active.has(s.number)}
                            onChange={() => setMany([s.number], !active.has(s.number))}
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-accent focus:ring-accent"
                          />
                          <span className="truncate text-zinc-600">#{s.number}{s.name ? ` ${s.name}` : ""}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
