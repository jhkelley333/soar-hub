// Admin — Command Center Links. Mint the per-store token that powers the
// public Store Command Center page (/s/:token), copy the bookmark URL, reset
// the device binding (new desktop), or revoke. One active link per store.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Copy, Eye, MonitorSmartphone, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import {
  fetchPortalAdminList, fetchPortalCalendar, mintPortalToken, resetPortalDevice,
  revokePortalToken, savePortalCalendar,
} from "./api";
import { QuickLinksManager } from "./QuickLinksManager";

const portalUrl = (token: string) => `${window.location.origin}/s/${token}`;

export function StorePortalAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const q = useQuery({ queryKey: ["store-portal-admin"], queryFn: fetchPortalAdminList });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["store-portal-admin"] });
  const err = (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error");
  const mint = useMutation({
    mutationFn: (storeId: string) => mintPortalToken(storeId),
    onSuccess: async (r) => {
      await navigator.clipboard?.writeText(portalUrl(r.token)).catch(() => {});
      toast.push("Link created and copied to your clipboard.", "success");
      invalidate();
    },
    onError: err,
  });
  const reset = useMutation({ mutationFn: resetPortalDevice, onSuccess: () => { toast.push("Device binding cleared — the next device to open the link claims it.", "success"); invalidate(); }, onError: err });
  const revoke = useMutation({ mutationFn: revokePortalToken, onSuccess: () => { toast.push("Link revoked.", "success"); invalidate(); }, onError: err });

  if (q.isLoading) return <div className="mx-auto max-w-4xl space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError) return <EmptyState title="Could not load" description={(q.error as Error)?.message ?? "Try again."} />;

  const needle = filter.trim().toLowerCase();
  const rows = (q.data?.stores ?? []).filter((s) =>
    !needle || String(s.number).includes(needle) || (s.name ?? "").toLowerCase().includes(needle) || (s.city ?? "").toLowerCase().includes(needle));

  const copy = async (token: string) => {
    await navigator.clipboard?.writeText(portalUrl(token)).catch(() => {});
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <MonitorSmartphone className="h-5 w-5 text-accent" />
        <h1 className="text-xl font-bold text-heading">Command Center Links</h1>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-ink-muted">
        Each store gets one no-login bookmark for its desktop. The link binds to the <em>first device that opens it</em> — a forwarded copy won't work.
        New desktop? <strong>Reset device</strong>. Link leaked? <strong>Replace</strong> mints a fresh one and kills the old.
      </p>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by store #, name, or city…"
        className="mb-4 w-72 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none" />

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-ink-subtle">
                <th className="px-4 py-2">Store</th><th className="px-4 py-2">Link</th>
                <th className="px-4 py-2">Device</th><th className="px-4 py-2">Last used</th><th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.store_id}>
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-heading">#{s.number}</span>
                    <span className="ml-2 text-ink-muted">{s.name}{s.city ? ` · ${s.city}` : ""}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.token
                      ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Active</span>
                      : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {s.token
                      ? s.token.bound
                        ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">Bound</span>
                        : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">Unclaimed</span>
                      : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {s.token?.last_used_at ? new Date(s.token.last_used_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link to={`/admin/store-portal/${s.store_id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:border-accent">
                        <Eye className="h-3.5 w-3.5" /> View live
                      </Link>
                      {s.token ? (
                        <>
                          <ActBtn onClick={() => copy(s.token!.token)}>
                            {copied === s.token.token ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}
                          </ActBtn>
                          {s.token.bound && (
                            <ActBtn onClick={() => reset.mutate(s.token!.id)}><RotateCcw className="h-3.5 w-3.5" /> Reset device</ActBtn>
                          )}
                          <ActBtn onClick={() => mint.mutate(s.store_id)}>Replace</ActBtn>
                          <ActBtn danger onClick={() => revoke.mutate(s.token!.id)}><XCircle className="h-3.5 w-3.5" /> Revoke</ActBtn>
                        </>
                      ) : (
                        <button onClick={() => mint.mutate(s.store_id)} disabled={mint.isPending}
                          className="rounded-lg bg-midnight px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
                          Create link
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <WhatsCookingSettings />
      <QuickLinksManager />
    </div>
  );
}

// What's Cooking — link a public iCal/ICS feed; store screens show its next
// events beside the hero.
function WhatsCookingSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["store-portal-calendar"], queryFn: fetchPortalCalendar });
  const [url, setUrl] = useState<string | null>(null);
  const value = url ?? q.data?.url ?? "";

  const save = useMutation({
    mutationFn: () => savePortalCalendar(value.trim()),
    onSuccess: (r) => {
      toast.push(r.url ? `Calendar linked — ${r.event_count} event${r.event_count === 1 ? "" : "s"} found.` : "Calendar unlinked.", "success");
      setUrl(null);
      qc.invalidateQueries({ queryKey: ["store-portal-calendar"] });
    },
    onError: (e: unknown) => toast.push((e as Error)?.message ?? "Could not save.", "error"),
  });

  return (
    <div className="mt-10">
      <div className="mb-1 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-accent" />
        <h2 className="text-lg font-bold text-heading">What's Cooking calendar</h2>
      </div>
      <p className="mb-3 max-w-2xl text-sm text-ink-muted">
        Link a public <strong>iCal/ICS</strong> feed and every store screen shows its upcoming events beside the hero — LTO launches, promos, visits.
        In Google Calendar: Settings → your calendar → Integrate calendar → <em>Secret address in iCal format</em>.
      </p>
      <div className="flex max-w-2xl gap-2">
        <input value={value} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-heading placeholder:text-ink-subtle focus:border-accent focus:outline-none" />
        <button disabled={save.isPending || value === (q.data?.url ?? "")} onClick={() => save.mutate()}
          className="rounded-lg bg-midnight px-4 py-2 text-xs font-semibold text-white transition hover:bg-midnight/90 disabled:opacity-40">
          {save.isPending ? "Checking…" : value.trim() ? "Save" : "Unlink"}
        </button>
      </div>
      {q.data?.url && (
        <p className="mt-1.5 text-xs text-ink-subtle">
          {q.data.event_count} event{q.data.event_count === 1 ? "" : "s"} synced
          {q.data.last_synced ? ` · last checked ${new Date(q.data.last_synced).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          {" "}· refreshes every 30 minutes
        </p>
      )}
    </div>
  );
}

function ActBtn({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-semibold transition",
        danger ? "text-red-600 hover:border-red-300 hover:bg-red-50" : "text-ink-2 hover:border-accent")}>
      {children}
    </button>
  );
}
