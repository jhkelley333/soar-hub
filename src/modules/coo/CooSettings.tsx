// COO "My Settings" — choose which day-to-day modules appear in your own
// sidebar. Saves to profiles.hidden_nav (migration 0327) through the
// profiles_update_self policy. Hiding never removes access: every module
// still opens from a link, and nothing changes for anyone else.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";
import { useOverrides } from "@/lib/roleAccess";
import { fetchResolvedFlags } from "@/lib/flags";
import { NOT_HIDEABLE, visibleNav } from "@/app/nav";

// Modules the Command Center already covers — suggested as hidden on first use.
const COVERED_BY_COMMAND_CENTER = [
  "/admin/ranking", "/labor-v2", "/pl", "/paf/archive", "/business-disruptions", "/employee-actions",
];

export function CooSettings() {
  const { profile, refresh } = useAuth();
  const toast = useToast();
  const { overrides } = useOverrides();
  const flagsQ = useQuery({ queryKey: ["feature-flags"], queryFn: fetchResolvedFlags, staleTime: 60_000 });

  const items = useMemo(
    () => visibleNav(profile?.role, flagsQ.data?.flags, overrides).filter((n) => !NOT_HIDEABLE.has(n.to)),
    [profile?.role, flagsQ.data, overrides],
  );

  const saved = useMemo(() => new Set(profile?.hidden_nav ?? []), [profile?.hidden_nav]);
  const [hidden, setHidden] = useState<Set<string>>(saved);
  useEffect(() => setHidden(new Set(saved)), [saved]);

  const dirty = hidden.size !== saved.size || [...hidden].some((h) => !saved.has(h));

  const save = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").update({ hidden_nav: [...hidden] }).eq("id", profile.id);
      if (error) throw new Error(error.message.includes("hidden_nav") ? "Settings need migration 0327 before they can be saved." : error.message);
    },
    onSuccess: async () => { toast.push("Sidebar saved.", "success"); await refresh(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  const toggle = (to: string) => setHidden((h) => { const n = new Set(h); if (n.has(to)) n.delete(to); else n.add(to); return n; });
  const hideCovered = () => setHidden((h) => new Set([...h, ...COVERED_BY_COMMAND_CENTER.filter((c) => items.some((i) => i.to === c))]));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-heading">Modules in my sidebar</h2>
            <p className="text-xs text-ink-muted">Off hides it from your sidebar only. Links still open it, and nothing changes for the field.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={hideCovered}>Hide what Command Center covers</Button>
            <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </div>
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const on = !hidden.has(it.to);
            return (
              <li key={it.to} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <it.icon className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
                  <span className="truncate text-sm font-medium text-heading">{it.label}</span>
                  {COVERED_BY_COMMAND_CENTER.includes(it.to) && (
                    <span className="hidden rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted sm:inline">In Command Center</span>
                  )}
                </div>
                <button
                  type="button" role="switch" aria-checked={on} aria-label={`Show ${it.label} in my sidebar`}
                  onClick={() => toggle(it.to)}
                  className={cn("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-accent" : "bg-zinc-300")}
                >
                  <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="h-fit p-4 text-sm text-ink-2">
        <h3 className="mb-1 font-semibold text-heading">How this works</h3>
        <p>Your sidebar shows {items.length - hidden.size} of {items.length} modules. Command Center, Account and System Settings always stay.</p>
        <p className="mt-2 text-ink-muted">The setting follows your login, so it's the same on your phone and laptop.</p>
      </Card>
    </div>
  );
}
