// Region Access — admin grid to control which nav modules each region sees,
// without editing code. Rows = modules (from nav.ts), columns = regions.
// Every region sees every module by default; a cell stores an override only
// when hidden, so the table holds just the deviations. Effective visibility
// is role-allowed AND region-allowed — this layer can only restrict.

import { useQueryClient, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Card } from "@/shared/ui/Card";
import { useToast } from "@/shared/ui/Toaster";
import { NAV } from "@/app/nav";
import {
  useRegionAccess,
  setRegionAccess,
  clearRegionAccess,
} from "@/lib/regionAccess";

export function RegionAccessPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { overrides, regions, isLoaded } = useRegionAccess();

  const mut = useMutation({
    mutationFn: async (args: { key: string; regionId: string; next: boolean }) => {
      // Default is visible (true). Toggling back to visible clears the
      // override; hiding stores visible=false.
      if (args.next) await clearRegionAccess(args.key, args.regionId);
      else await setRegionAccess(args.key, args.regionId, false);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["region-access"] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  function toggle(key: string, regionId: string, current: boolean) {
    mut.mutate({ key, regionId, next: !current });
  }

  return (
    <>
      <PageHeader
        title="Region Access"
        description="Control which modules each region sees — every region has access by default; uncheck to hide a module from that region's users. A user must be allowed by both their role and their region. This governs visibility; data security is still enforced server-side."
      />

      {!isLoaded ? (
        <Skeleton className="h-64 w-full" />
      ) : regions.length === 0 ? (
        <Card>
          <EmptyState
            title="No regions yet"
            description="Region Access needs at least one region in the org hierarchy. Add regions in Org Admin first."
          />
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th className="sticky left-0 z-10 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Module
                </th>
                {regions.map((r) => (
                  <th key={r.id} className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NAV.map((item) => (
                <tr key={item.to} className="border-t border-zinc-100">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                    <div className="font-medium text-midnight">{item.label}</div>
                    <div className="font-mono text-[11px] text-zinc-400">{item.to}</div>
                  </td>
                  {regions.map((r) => {
                    const ov = overrides[item.to]?.[r.id];
                    const effective = ov !== undefined ? ov : true; // default visible
                    const overridden = ov !== undefined;
                    return (
                      <td key={r.id} className="px-3 py-2.5 text-center">
                        <label className="inline-flex cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            checked={effective}
                            disabled={mut.isPending}
                            onChange={() => toggle(item.to, r.id, effective)}
                            className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
                          />
                          {overridden && (
                            <span
                              title="Hidden from this region"
                              className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                            />
                          )}
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500">
        A dot marks a module hidden from that region. Re-checking restores the default (visible).
        Admins and company-wide roles (VP/COO) aren't region-gated. Changes take effect on the
        user's next page load (nav + access refresh within a minute).
      </p>
    </>
  );
}
