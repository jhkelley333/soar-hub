// Role Access — admin grid to control which nav modules each role sees,
// without editing code. Rows = modules (from nav.ts), columns = roles.
// A cell stores an override only when it differs from the code default,
// so the table holds just the deviations. Admin always has full access
// and isn't shown as a togglable column.

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { NAV } from "@/app/nav";
import {
  useOverrides,
  setModuleAccess,
  clearModuleAccess,
} from "@/lib/roleAccess";
import { ROLE_LABELS, type UserRole } from "@/types/database";

// Columns the admin grid offers as togglable. Admin is intentionally
// excluded (always full access). Back-office / horizontal roles
// (payroll, accounting, facilities, human_resources, fbc) sit after
// the field hierarchy so they appear together on the right side of
// the grid for easier scanning.
const ROLE_COLS: UserRole[] = [
  "shift_manager", "first_assistant_manager", "associate_manager",
  "crew_leader", "crew_member", "carhop",
  "gm", "do", "sdo", "rvp", "vp", "coo",
  "payroll", "accounting", "facilities", "human_resources", "fbc",
];

function defaultVisible(role: UserRole, roles: UserRole[] | null): boolean {
  return roles === null ? true : roles.includes(role);
}

export function RoleAccessPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { overrides } = useOverrides();
  // Mirror the hook's loading so we can show a skeleton.
  const q = useQuery({ queryKey: ["role-access"], enabled: false });

  const mut = useMutation({
    mutationFn: async (args: { key: string; role: UserRole; next: boolean; isDefault: boolean }) => {
      if (args.isDefault) await clearModuleAccess(args.key, args.role);
      else await setModuleAccess(args.key, args.role, args.next);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["role-access"] });
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  function toggle(key: string, role: UserRole, roles: UserRole[] | null, current: boolean) {
    const next = !current;
    // If the new value matches the code default, clear the override
    // (keeps the table to deviations only); otherwise store the override.
    const isDefault = next === defaultVisible(role, roles);
    mut.mutate({ key, role, next, isDefault });
  }

  return (
    <>
      <PageHeader
        title="Role Access"
        description="Control which modules each role sees — overrides the built-in defaults. Admins always have full access. This governs visibility; data security is still enforced server-side."
      />

      {q.isFetching && !q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-left">
                <th className="sticky left-0 z-10 bg-zinc-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Module
                </th>
                {ROLE_COLS.map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {ROLE_LABELS[r] ?? r}
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
                  {ROLE_COLS.map((role) => {
                    const ov = overrides[item.to]?.[role];
                    const def = defaultVisible(role, item.roles);
                    const effective = ov !== undefined ? ov : def;
                    const overridden = ov !== undefined;
                    return (
                      <td key={role} className="px-3 py-2.5 text-center">
                        <label className="inline-flex cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            checked={effective}
                            disabled={mut.isPending}
                            onChange={() => toggle(item.to, role, item.roles, effective)}
                            className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
                          />
                          {overridden && (
                            <span
                              title="Overrides the default"
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
        A dot marks a cell that differs from the built-in default. Toggling back to the default clears the override.
        Changes take effect on the user's next page load (nav + access refresh within a minute).
      </p>
    </>
  );
}
