// /admin/gm-roster — GM roster reconciliation. Shows every store's roster GM
// next to the actual Hub account, flagging who has no account or whose name
// doesn't match, so the roster and the accounts can be kept in sync. Fixes are
// made in Team/Org admin (this page flags, it doesn't edit accounts). A paste
// importer keeps the roster current from the ops sheet.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, HelpCircle, Upload, UserX } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchGmRoster, importGmRoster, parseRosterPaste, type GmRosterRow, type ReconcileStatus } from "./gmRosterApi";

type Filter = "all" | ReconcileStatus;

const STATUS_META: Record<ReconcileStatus, { label: string; cls: string; icon: typeof Check }> = {
  matched: { label: "Matched", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: Check },
  no_account: { label: "No account", cls: "bg-amber-50 text-amber-700 ring-amber-200", icon: UserX },
  mismatch: { label: "Name mismatch", cls: "bg-red-50 text-red-700 ring-red-200", icon: AlertTriangle },
  open: { label: "Open", cls: "bg-zinc-100 text-zinc-500 ring-zinc-200", icon: HelpCircle },
  in_training: { label: "In training", cls: "bg-sky-50 text-sky-700 ring-sky-200", icon: HelpCircle },
};

export function GmRosterPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const q = useQuery({ queryKey: ["gm-roster"], queryFn: fetchGmRoster });

  const rows = useMemo(() => {
    let r = q.data?.rows ?? [];
    if (filter !== "all") r = r.filter((x) => x.reconcile === filter);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter((x) =>
      `${x.store_number} ${x.store_name ?? ""} ${x.roster_name ?? ""} ${x.account?.name ?? ""} ${x.rvp_name ?? ""}`.toLowerCase().includes(s));
    return r;
  }, [q.data, filter, search]);

  const summary = q.data?.summary;

  return (
    <>
      <PageHeader
        title="GM Roster"
        description="Reconcile the GM roster with Hub accounts — who's missing an account or whose name doesn't match."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1 h-3.5 w-3.5" /> Import roster
          </Button>
        }
      />

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}

      {summary && (
        <div className="mb-3 flex flex-wrap gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All ${q.data!.rows.length}`} />
          {(["mismatch", "no_account", "matched", "open", "in_training"] as ReconcileStatus[]).map((k) =>
            summary[k] ? (
              <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}
                label={`${STATUS_META[k].label} ${summary[k]}`} cls={STATUS_META[k].cls} />
            ) : null,
          )}
        </div>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search store #, name, GM, RVP…"
        className="mb-3 w-full max-w-md rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />

      {q.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <EmptyState title="Couldn't load the roster" description={(q.error as Error)?.message ?? "Try again."} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="No roster rows for this filter/search." />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-2">Store</th>
                  <th className="px-4 py-2">Roster GM</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Hub account</th>
                  <th className="px-4 py-2">RVP · SDO · DO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => <Row key={r.store_number} r={r} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ r }: { r: GmRosterRow }) {
  const meta = STATUS_META[r.reconcile];
  const Icon = meta.icon;
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5">
        <div className="font-semibold text-midnight">#{r.store_number}</div>
        <div className="text-xs text-zinc-500">{r.store_name ?? ""}{!r.in_app && <span className="ml-1 text-red-500">· not in app</span>}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="text-midnight">{r.roster_name ?? <span className="text-zinc-400">—</span>}</div>
        {r.gm_email && <div className="text-[11px] text-zinc-400">{r.gm_email}</div>}
      </td>
      <td className="px-4 py-2.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", meta.cls)}>
          <Icon className="h-3 w-3" /> {meta.label}
        </span>
      </td>
      <td className="px-4 py-2.5">
        {r.account ? (
          <>
            <div className={cn(r.reconcile === "mismatch" ? "font-semibold text-red-700" : "text-midnight")}>{r.account.name}</div>
            {r.account.email && <div className="text-[11px] text-zinc-400">{r.account.email}</div>}
          </>
        ) : (
          <span className="text-zinc-400">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-500">
        {[r.rvp_name, r.sdo_name, r.do_name].filter(Boolean).join(" · ") || "—"}
      </td>
    </tr>
  );
}

function FilterChip({ active, onClick, label, cls }: { active: boolean; onClick: () => void; label: string; cls?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition",
        active ? "bg-accent text-white ring-accent" : cls || "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")}
    >
      {label}
    </button>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseRosterPaste(text), [text]);

  const mut = useMutation({
    mutationFn: () => importGmRoster(parsed),
    onSuccess: (r) => {
      toast.push(`Imported ${r.upserted} roster row${r.upserted === 1 ? "" : "s"}.`, "success");
      qc.invalidateQueries({ queryKey: ["gm-roster"] });
      onClose();
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Import failed.", "error"),
  });

  return (
    <Modal open onClose={onClose} title="Import GM roster"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mut.mutate()} disabled={!parsed.length || mut.isPending}>
            {mut.isPending ? "Importing…" : `Import ${parsed.length} row${parsed.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }>
      <p className="mb-2 text-xs text-zinc-500">
        Paste the roster sheet (tab-separated), including the columns Store #, Store Name, GM (Full Name),
        Date of Hire, Date of Placement, GM Cell, GM Birthday, and Store Email. A header row is ignored.
        Existing stores are updated; `OPEN` / `In Training` / blank become non-person statuses.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        placeholder="Paste rows here…"
        className="w-full resize-y rounded-lg border-0 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="mt-1 text-[11px] text-zinc-400">{parsed.length} store row{parsed.length === 1 ? "" : "s"} detected.</div>
    </Modal>
  );
}
