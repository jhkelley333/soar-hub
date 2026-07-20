// /admin/access-links — mint and manage standing "stay logged in" links.
// A link is bound to one person; opening /go/<token> signs that device in as
// them and keeps it logged in until the link is revoked. Because the URL IS the
// credential, treat every link like a password: share it privately (AirDrop /
// Signal / 1Password), and revoke the moment a device is lost. Mint/revoke is
// admin/VP/COO only; every open is logged (last opened + IP).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Trash2, Plus, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { useToast } from "@/shared/ui/Toaster";
import { fetchAccessLinks, mintAccessLink, revokeAccessLink } from "./api";

export function AccessLinksPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["access-links"], queryFn: fetchAccessLinks });

  const takenUserIds = useMemo(
    () => new Set((q.data?.links ?? []).map((l) => l.user_id)),
    [q.data]
  );
  const candidates = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.users ?? [])
      .filter((u) => !takenUserIds.has(u.id))
      .filter((u) => !s || `${u.name} ${u.email ?? ""} ${u.role ?? ""}`.toLowerCase().includes(s));
  }, [q.data, takenUserIds, search]);

  const mint = useMutation({
    mutationFn: (input: { user_id: string; label?: string }) => mintAccessLink(input),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access-links"] });
      setPick("");
      setSearch("");
      toast.push(r.reused ? "That person already had a link." : "Link created.", "success");
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't create the link.", "error"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeAccessLink(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["access-links"] }); toast.push("Link revoked.", "success"); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't revoke.", "error"),
  });

  async function copy(token: string) {
    const url = `${window.location.origin}/go/${token}`;
    try { await navigator.clipboard.writeText(url); toast.push("Link copied.", "success"); }
    catch { toast.push(url, "info"); }
  }

  const links = q.data?.links ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader title="Stay-logged-in links" description="Standing sign-in links for people who need to stay logged in without a password." />

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          Each link is a full credential for that person — anyone who opens it is signed in as them and stays
          logged in until you revoke it here. Share links privately (AirDrop, Signal, 1Password), never by
          plain email, and revoke immediately if a device is lost.
        </div>
      </div>

      {/* Mint */}
      <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="text-sm font-semibold text-midnight">Create a link</div>
        <p className="mt-0.5 text-xs text-zinc-500">Pick the person this link signs in as.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or role…"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:max-w-[220px]"
          />
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">Select a person…</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}{u.role ? ` · ${u.role.toUpperCase()}` : ""}{u.email ? ` · ${u.email}` : ""}
              </option>
            ))}
          </select>
          <Button
            onClick={() => pick && mint.mutate({ user_id: pick })}
            disabled={!pick || mint.isPending}
          >
            {mint.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            Create
          </Button>
        </div>
        {candidates.length === 0 && search.trim() && (
          <p className="mt-2 text-xs text-zinc-400">No matches (people who already have a link are hidden).</p>
        )}
      </div>

      {/* List */}
      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-midnight">Active links</div>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
        ) : links.length === 0 ? (
          <EmptyState title="No links yet" description="Create a link above to give someone standing access." />
        ) : (
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-midnight">
                    {l.user_name}
                    {l.user_role ? <span className="ml-1.5 text-[11px] font-medium text-zinc-400">{l.user_role.toUpperCase()}</span> : null}
                  </div>
                  <div className="truncate text-[11px] text-zinc-400">
                    /go/{l.token.slice(0, 10)}…{" "}
                    {l.last_used_at
                      ? `· last opened ${new Date(l.last_used_at).toLocaleString()}${l.last_used_ip ? ` · ${l.last_used_ip}` : ""}`
                      : "· never opened"}
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => copy(l.token)}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(l.id)} disabled={revoke.isPending} className="text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
