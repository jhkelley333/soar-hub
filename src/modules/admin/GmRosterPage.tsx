// /admin/gm-roster — GM roster reconciliation. Shows every store's roster GM
// next to the actual Hub account, flagging who has no account or whose name
// doesn't match, so the roster and the accounts can be kept in sync. Fixes are
// made in Team/Org admin (this page flags, it doesn't edit accounts). A paste
// importer keeps the roster current from the ops sheet.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Cake, Check, Download, HelpCircle, History, Mail, Pencil, Phone, Upload, UserX } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchGmLeaders, fetchGmRoster, fetchGmRosterHistory, importGmRoster, setGmRosterDetails, setGmRosterName, type GmRosterHistoryEntry, type GmRosterRow, type LeaderRow, type ReconcileStatus } from "./gmRosterApi";
import type { UseQueryResult } from "@tanstack/react-query";
import { diffUpload, fmtDate, mergedImportRow, parseDate, parsePaste, parseRosterXlsx, sinceLabel, type DiffRow, type UploadRow } from "./rosterImport";

type Filter = "all" | ReconcileStatus | "no_credit";

const NO_GM_REASON_LABEL: Record<string, string> = { no_gm: "No GM", loa: "LOA", in_training: "In training" };
const ROLE_LABEL: Record<string, string> = { do: "DO", sdo: "SDO", rvp: "RVP" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STATUS_META: Record<ReconcileStatus, { label: string; cls: string; icon: typeof Check }> = {
  matched: { label: "Matched", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: Check },
  no_account: { label: "No account", cls: "bg-amber-50 text-amber-700 ring-amber-200", icon: UserX },
  mismatch: { label: "Name mismatch", cls: "bg-red-50 text-red-700 ring-red-200", icon: AlertTriangle },
  open: { label: "Open", cls: "bg-zinc-100 text-zinc-500 ring-zinc-200", icon: HelpCircle },
  in_training: { label: "In training", cls: "bg-sky-50 text-sky-700 ring-sky-200", icon: HelpCircle },
};

export function GmRosterPage() {
  const [tab, setTab] = useState<"gms" | "leaders">("gms");
  const [bdayOpen, setBdayOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [historyRow, setHistoryRow] = useState<GmRosterRow | null>(null);
  const [editRow, setEditRow] = useState<GmRosterRow | null>(null);
  const q = useQuery({ queryKey: ["gm-roster"], queryFn: fetchGmRoster });
  // Leaders power the Leaders tab + the birthday view; fetched up front (one
  // light request) so the Birthdays button works from either tab.
  const leadersQ = useQuery({ queryKey: ["gm-leaders"], queryFn: fetchGmLeaders });

  const rows = useMemo(() => {
    let r = q.data?.rows ?? [];
    if (filter === "no_credit") r = r.filter((x) => x.no_gm_credit);
    else if (filter !== "all") r = r.filter((x) => x.reconcile === filter);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter((x) =>
      `${x.store_number} ${x.store_name ?? ""} ${x.roster_name ?? ""} ${x.account?.name ?? ""} ${x.rvp_name ?? ""}`.toLowerCase().includes(s));
    return r;
  }, [q.data, filter, search]);

  const summary = q.data?.summary;
  const noCreditCount = useMemo(() => (q.data?.rows ?? []).filter((r) => r.no_gm_credit).length, [q.data]);

  // Download the rows currently shown (respects the active filter + search) as a CSV.
  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Store #", "Store Name", "In App", "Roster GM", "GM Email", "Status", "No GM Credit", "Hub Account", "Hub Email", "RVP", "SDO", "DO"];
    const body = rows.map((r) => [
      r.store_number, r.store_name ?? "", r.in_app ? "yes" : "no",
      r.roster_name ?? "", r.gm_email ?? "", STATUS_META[r.reconcile].label,
      r.no_gm_credit ? (NO_GM_REASON_LABEL[r.no_gm_reason ?? ""] ?? "yes") : "no",
      r.account?.name ?? "", r.account?.email ?? "",
      r.rvp_name ?? "", r.sdo_name ?? "", r.do_name ?? "",
    ]);
    const csv = [head, ...body].map((row) => row.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gm-roster.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Roster"
        description="GMs and leadership — reconcile the GM roster with Hub accounts, see the DO/SDO/RVP roster, and this month's birthdays."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setBdayOpen(true)}>
              <Cake className="mr-1 h-3.5 w-3.5" /> Birthdays
            </Button>
            {tab === "gms" && (
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
                <Download className="mr-1 h-3.5 w-3.5" /> Download
              </Button>
            )}
            {tab === "gms" && q.data?.can_import && (
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1 h-3.5 w-3.5" /> Import roster
              </Button>
            )}
          </div>
        }
      />

      {importOpen && <ImportModal current={q.data?.rows ?? []} onClose={() => setImportOpen(false)} />}
      {historyRow && <HistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />}
      {editRow && <EditGmModal row={editRow} onClose={() => setEditRow(null)} />}
      {bdayOpen && <BirthdayModal gmRows={q.data?.rows ?? []} leaders={leadersQ.data?.rows ?? []} onClose={() => setBdayOpen(false)} />}

      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        <TabButton active={tab === "gms"} onClick={() => setTab("gms")} label="GMs" count={q.data?.rows.length} />
        <TabButton active={tab === "leaders"} onClick={() => setTab("leaders")} label="Leaders (DO · SDO · RVP)" count={leadersQ.data?.rows.length} />
      </div>

      {tab === "leaders" ? (
        <LeadersTab q={leadersQ} />
      ) : (
        <>
      {summary && (
        <div className="mb-3 flex flex-wrap gap-2">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All ${q.data!.rows.length}`} />
          {(["mismatch", "no_account", "matched", "open", "in_training"] as ReconcileStatus[]).map((k) =>
            summary[k] ? (
              <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)}
                label={`${STATUS_META[k].label} ${summary[k]}`} cls={STATUS_META[k].cls} />
            ) : null,
          )}
          {noCreditCount > 0 && (
            <FilterChip active={filter === "no_credit"} onClick={() => setFilter("no_credit")}
              label={`No GM credit ${noCreditCount}`} cls="bg-orange-50 text-orange-700 ring-orange-200" />
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
                  <th className="px-4 py-2">Tenure · Stability</th>
                  <th className="px-4 py-2">Hub account</th>
                  <th className="px-4 py-2">RVP · SDO · DO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => <Row key={r.store_number} r={r} canEdit={q.data?.can_edit ?? false} onHistory={() => setHistoryRow(r)} onEdit={() => setEditRow(r)} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}
    </>
  );
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition",
        active ? "border-accent text-accent" : "border-transparent text-zinc-500 hover:text-zinc-700")}
    >
      {label}{count != null && <span className="ml-1.5 text-xs font-normal text-zinc-400">{count}</span>}
    </button>
  );
}

// ── Leaders tab (DO / SDO / RVP roster) ─────────────────────────────────────
function LeadersTab({ q }: { q: UseQueryResult<{ ok: true; rows: LeaderRow[] }> }) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const all = q.data?.rows ?? [];
    const s = search.trim().toLowerCase();
    return s
      ? all.filter((r) => `${r.name ?? ""} ${ROLE_LABEL[r.role]} ${r.coverage.join(" ")} ${(r.additional ?? []).join(" ")} ${r.email ?? ""}`.toLowerCase().includes(s))
      : all;
  }, [q.data, search]);

  if (q.isLoading) return <Skeleton className="h-96 w-full" />;
  if (q.isError) return <EmptyState title="Couldn't load leaders" description={(q.error as Error)?.message ?? "Try again."} />;
  if (!rows.length && !search) return <EmptyState title="No leaders found" description="No DO / SDO / RVP resolved for your scope." />;

  return (
    <>
      <div className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-inset ring-sky-200">
        Leader details (phone, email, birthday) come from each person's Hub profile — update them in <strong>My Team</strong>, not here.
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search name, role, coverage…"
        className="mb-3 w-full max-w-md rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" description="No leaders for that search." />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Role</th>
                  <th className="px-4 py-2">Coverage</th>
                  <th className="px-4 py-2">Contact</th>
                  <th className="px-4 py-2">Birthday</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => <LeaderRowView key={r.id} r={r} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function LeaderRowView({ r }: { r: LeaderRow }) {
  const tone = r.role === "rvp" ? "bg-accent-100 text-accent-700" : r.role === "sdo" ? "bg-sky-50 text-sky-700" : "bg-zinc-100 text-zinc-600";
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5 font-semibold text-midnight">{r.name ?? "—"}</td>
      <td className="px-4 py-2.5">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tone)}>{ROLE_LABEL[r.role]}</span>
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-500">
        {r.coverage.length ? r.coverage.join(" · ") : "—"}
        {(r.additional ?? []).length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(r.additional ?? []).map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                + Acting · {a}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {r.email || r.phone ? (
          <div className="flex flex-col gap-0.5">
            {r.email && <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 text-accent hover:underline"><Mail className="h-3 w-3" />{r.email}</a>}
            {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-zinc-600 hover:underline"><Phone className="h-3 w-3" />{r.phone}</a>}
          </div>
        ) : <span className="text-zinc-400">—</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-zinc-600">{r.birthday ? `🎂 ${fmtDate(r.birthday)}` : <span className="text-zinc-400">—</span>}</td>
    </tr>
  );
}

// ── Birthday view — this (or any) month's birthdays across GMs + leaders ─────
function BirthdayModal({ gmRows, leaders, onClose }: { gmRows: GmRosterRow[]; leaders: LeaderRow[]; onClose: () => void }) {
  const [month, setMonth] = useState(new Date().getMonth()); // 0-11

  // Every birthday across GMs + leaders (DO/SDO/RVP), all months.
  const allEntries = useMemo(() => {
    type E = { key: string; name: string; sub: string; who: string; mo: number; day: number; disp: string; kind: "gm" | "leader" };
    const out: E[] = [];
    const md = (raw: string | null | undefined) => {
      const iso = parseDate(raw);
      if (!iso) return null;
      const [, m, d] = iso.split("-").map(Number);
      return { mo: m - 1, day: d, disp: new Date(2000, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) };
    };
    for (const r of gmRows) {
      const p = md(r.gm_birthday);
      if (!p || !r.roster_name) continue;
      out.push({ key: `gm-${r.store_number}`, name: r.roster_name, sub: `#${r.store_number}${r.store_name ? ` · ${r.store_name}` : ""} · GM`, who: `#${r.store_number} ${r.store_name ?? ""}`.trim(), ...p, kind: "gm" });
    }
    for (const l of leaders) {
      const p = md(l.birthday);
      if (!p || !l.name) continue;
      out.push({ key: `ldr-${l.id}`, name: l.name, sub: `${ROLE_LABEL[l.role]}${l.coverage.length ? ` · ${l.coverage.join(", ")}` : ""}`, who: `${ROLE_LABEL[l.role]}${l.coverage.length ? ` · ${l.coverage.join(", ")}` : ""}`, ...p, kind: "leader" });
    }
    return out.sort((a, b) => a.mo - b.mo || a.day - b.day || a.name.localeCompare(b.name));
  }, [gmRows, leaders]);

  const entries = useMemo(() => allEntries.filter((e) => e.mo === month), [allEntries, month]);

  const downloadAll = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = ["Name", "Type", "Store / Coverage", "Birthday"];
    const body = allEntries.map((e) => [e.name, e.kind === "gm" ? "GM" : "Leader", e.who, e.disp]);
    const csv = [head, ...body].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "birthdays.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const nav = "rounded-md px-2 py-1 text-zinc-500 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50";
  return (
    <Modal open onClose={onClose} title="Birthdays" maxWidth="max-w-lg">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" className={nav} onClick={() => setMonth((m) => (m + 11) % 12)} aria-label="Previous month">‹</button>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm font-semibold focus:border-accent focus:outline-none">
          {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>
        <button type="button" className={nav} onClick={() => setMonth((m) => (m + 1) % 12)} aria-label="Next month">›</button>
        <span className="ml-1 text-xs text-zinc-400">{entries.length} birthday{entries.length === 1 ? "" : "s"}</span>
        <button type="button" className="ml-auto text-xs font-semibold text-accent hover:underline" onClick={() => setMonth(new Date().getMonth())}>This month</button>
        <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline" onClick={downloadAll} title="Download all birthdays (GMs + DO/SDO/RVP)">
          <Download className="h-3.5 w-3.5" /> Download
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">No birthdays in {MONTHS[month]}.</p>
      ) : (
        <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.key} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 ring-1 ring-inset ring-zinc-100">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-midnight">{e.name}</div>
                <div className="truncate text-[11px] text-zinc-500">{e.sub}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", e.kind === "gm" ? "bg-emerald-50 text-emerald-600" : "bg-accent-100 text-accent-700")}>{e.kind === "gm" ? "GM" : "Leader"}</span>
                <span className="text-xs font-semibold text-zinc-600">🎂 {e.disp}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Row({ r, canEdit, onHistory, onEdit }: { r: GmRosterRow; canEdit: boolean; onHistory: () => void; onEdit: () => void }) {
  const meta = STATUS_META[r.reconcile];
  const Icon = meta.icon;
  return (
    <tr className="align-top">
      <td className="px-4 py-2.5">
        <div className="font-semibold text-midnight">#{r.store_number}</div>
        <div className="text-xs text-zinc-500">{r.store_name ?? ""}{!r.in_app && <span className="ml-1 text-red-500">· not in app</span>}</div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-midnight">{r.roster_name ?? <span className="text-zinc-400">—</span>}</span>
          {r.no_gm_credit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700 ring-1 ring-inset ring-orange-200" title="Active No-GM labor credit (from Labor → No-GM credit)">
              <Ban className="h-3 w-3" /> No GM credit{NO_GM_REASON_LABEL[r.no_gm_reason ?? ""] ? ` · ${NO_GM_REASON_LABEL[r.no_gm_reason ?? ""]}` : ""}
            </span>
          )}
          {canEdit && (
            <button type="button" onClick={onEdit} title="Edit GM — name, phone, birthday, hire & placement" className="text-zinc-300 hover:text-accent">
              <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          )}
          <button type="button" onClick={onHistory} title="Edit history" className="text-zinc-300 hover:text-accent">
            <History className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <div className="text-[11px] text-zinc-400">
          {r.gm_email && <div>{r.gm_email}</div>}
          {(r.gm_cell || r.gm_birthday) && (
            <div>{[r.gm_cell, r.gm_birthday ? `🎂 ${fmtDate(r.gm_birthday)}` : null].filter(Boolean).join(" · ")}</div>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", meta.cls)}>
          <Icon className="h-3 w-3" /> {meta.label}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs">
        <div className="text-zinc-600">
          <span className="text-zinc-400">Hire</span> {fmtDate(r.hire_date)}
          {sinceLabel(r.hire_date) && <span className="ml-1 font-semibold text-midnight">· {sinceLabel(r.hire_date)}</span>}
        </div>
        <div className="text-zinc-600">
          <span className="text-zinc-400">Placed</span> {fmtDate(r.placement_date)}
          {sinceLabel(r.placement_date) && <span className="ml-1 font-semibold text-midnight">· {sinceLabel(r.placement_date)}</span>}
        </div>
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

function HistoryModal({ row, onClose }: { row: GmRosterRow; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["gm-roster-history", row.store_number],
    queryFn: () => fetchGmRosterHistory(row.store_number),
  });
  const entries = q.data?.entries ?? [];
  return (
    <Modal open onClose={onClose} title={`Edit history — #${row.store_number}${row.store_name ? ` · ${row.store_name}` : ""}`}>
      {q.isLoading ? (
        <div className="py-6 text-center text-sm text-zinc-500">Loading…</div>
      ) : q.isError ? (
        <div className="py-6 text-center text-sm text-red-600">{(q.error as Error)?.message ?? "Couldn't load history."}</div>
      ) : entries.length === 0 ? (
        <div className="py-6 text-center text-sm text-zinc-500">No edits recorded yet — changes are logged from here on.</div>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => <HistoryEntry key={e.id} e={e} />)}
        </ul>
      )}
    </Modal>
  );
}

// One edit for the whole GM: name (+ Open / In Training), phone, birthday, hire
// and placement dates. When the name changes to a new person, require an
// explicit confirm that the birthday / hire / placement / phone were updated too.
const isRealGmName = (s: string) => { const t = s.trim(); return !!t && !/^open$/i.test(t) && !/in\s*training/i.test(t); };

function EditGmModal({ row, onClose }: { row: GmRosterRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const init = {
    name: row.roster_name ?? "",
    cell: row.gm_cell ?? "",
    birthday: parseDate(row.gm_birthday) ?? "",
    hire: parseDate(row.hire_date) ?? "",
    placement: parseDate(row.placement_date) ?? "",
  };
  const [name, setName] = useState(init.name);
  const [cell, setCell] = useState(init.cell);
  const [birthday, setBirthday] = useState(init.birthday);
  const [hire, setHire] = useState(init.hire);
  const [placement, setPlacement] = useState(init.placement);
  const [confirmedNew, setConfirmedNew] = useState(false);

  const nameChanged = name.trim() !== init.name.trim();
  const isNewGm = nameChanged && isRealGmName(name);
  const detailsDirty = cell !== init.cell || birthday !== init.birthday || hire !== init.hire || placement !== init.placement;
  const dirty = nameChanged || detailsDirty;
  const blocked = isNewGm && !confirmedNew;

  const save = useMutation({
    mutationFn: async () => {
      if (nameChanged) await setGmRosterName(row.store_number, name.trim());
      const fields: { gm_cell?: string | null; gm_birthday?: string | null; hire_date?: string | null; placement_date?: string | null } = {};
      if (cell !== init.cell) fields.gm_cell = cell.trim() || null;
      if (birthday !== init.birthday) fields.gm_birthday = birthday || null;
      if (hire !== init.hire) fields.hire_date = hire || null;
      if (placement !== init.placement) fields.placement_date = placement || null;
      if (Object.keys(fields).length) await setGmRosterDetails(row.store_number, fields);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["gm-roster"] }); toast.push("GM saved.", "success"); onClose(); },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });

  // Wipe every field — for a store going vacant (No GM) or a new GM coming in,
  // so the previous GM's data isn't carried over. Saving all-blank sets Open.
  const clearAll = () => { setName(""); setCell(""); setBirthday(""); setHire(""); setPlacement(""); setConfirmedNew(false); };

  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";
  return (
    <Modal open onClose={onClose} title={`Edit GM — #${row.store_number}${row.store_name ? ` · ${row.store_name}` : ""}`}
      footer={
        <>
          <Button variant="ghost" size="sm" className="mr-auto text-red-600 hover:bg-red-50" onClick={clearAll}>Clear all</Button>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || blocked || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
        </>
      }>
      <div className="space-y-3">
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">GM name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="GM name — or Open / In Training" className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">GM cell phone</span>
          <input type="tel" value={cell} onChange={(e) => setCell(e.target.value)} placeholder="(555) 123-4567" className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Birthday</span>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Hire date (with SOAR)</span>
          <input type="date" value={hire} onChange={(e) => setHire(e.target.value)} className={cls} /></label>
        <label className="block"><span className="mb-0.5 block text-xs font-semibold text-zinc-500">Placement date (as GM)</span>
          <input type="date" value={placement} onChange={(e) => setPlacement(e.target.value)} className={cls} /></label>

        {isNewGm && (
          <label className={cn("flex items-start gap-2 rounded-md px-2.5 py-2 text-xs ring-1 ring-inset", confirmedNew ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200")}>
            <input type="checkbox" checked={confirmedNew} onChange={(e) => setConfirmedNew(e.target.checked)} className="mt-0.5" />
            <span>New GM — I've updated the <b>birthday, hire date, placement date, and phone</b> for {name.trim()} (not carried over from the previous GM).</span>
          </label>
        )}

        {row.no_gm_credit && (
          <div className="mt-1 flex items-start gap-2 rounded-md bg-orange-50 px-2.5 py-2 text-[11px] ring-1 ring-inset ring-orange-200">
            <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600" />
            <span className="text-orange-800">
              <b>No GM credit{NO_GM_REASON_LABEL[row.no_gm_reason ?? ""] ? ` · ${NO_GM_REASON_LABEL[row.no_gm_reason ?? ""]}` : ""}</b> — set from the store's active No-GM labor credit. Manage it under Labor → No-GM credit.
            </span>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-zinc-400">Blank a field to clear it. "Open" / "In Training" set the status instead of a name.</p>
    </Modal>
  );
}

function HistoryEntry({ e }: { e: GmRosterHistoryEntry }) {
  const val = (v: string | null) => (v && v.trim() ? v : "—");
  const nameChanged = (e.old_gm_name ?? "") !== (e.new_gm_name ?? "");
  const statusChanged = (e.old_status ?? "") !== (e.new_status ?? "");
  const when = new Date(e.changed_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <li className="rounded-lg bg-zinc-50 px-3 py-2 ring-1 ring-inset ring-zinc-100">
      {nameChanged && (
        <div className="text-sm text-midnight">
          <span className="text-zinc-400 line-through">{val(e.old_gm_name)}</span>
          <span className="mx-1 text-zinc-400">→</span>
          <span className="font-semibold">{val(e.new_gm_name)}</span>
        </div>
      )}
      {statusChanged && (
        <div className="text-xs text-zinc-600">Status: {val(e.old_status)} <span className="text-zinc-400">→</span> <span className="font-semibold">{val(e.new_status)}</span></div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
        <span className={cn("rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide", e.source === "import" ? "bg-sky-50 text-sky-600" : "bg-emerald-50 text-emerald-600")}>{e.source}</span>
        <span>{e.changed_by_name ?? "—"} · {when}</span>
      </div>
    </li>
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

function ImportModal({ current, onClose }: { current: GmRosterRow[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [paste, setPaste] = useState("");
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const diffs = useMemo(() => diffUpload(uploads, current), [uploads, current]);
  const changed = diffs.filter((d) => d.status === "changed");
  const news = diffs.filter((d) => d.status === "new");
  const unchanged = diffs.filter((d) => d.status === "unchanged").length;

  // Load a parsed upload: default to accepting all the changed rows (user can
  // decline); new (not-in-roster) rows start declined and flagged.
  const load = (rows: UploadRow[]) => {
    setUploads(rows);
    setAccepted(new Set(diffUpload(rows, current).filter((d) => d.status === "changed").map((d) => d.store_number)));
  };
  const onFile = async (f: File) => {
    setFileName(f.name);
    try { load(f.name.toLowerCase().endsWith(".xlsx") ? await parseRosterXlsx(f) : parsePaste(await f.text())); }
    catch (e) { toast.push(e instanceof Error ? e.message : "Couldn't read that file.", "error"); }
  };
  const toggle = (n: string) => setAccepted((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const setAll = (list: DiffRow[], on: boolean) => setAccepted((s) => { const x = new Set(s); for (const d of list) on ? x.add(d.store_number) : x.delete(d.store_number); return x; });

  const acceptedRows = useMemo(
    () => diffs.filter((d) => accepted.has(d.store_number)).map((d) => mergedImportRow(uploads.find((u) => u.store_number === d.store_number)!, current)),
    [diffs, accepted, uploads, current],
  );

  const mut = useMutation({
    mutationFn: () => importGmRoster(acceptedRows as unknown as Parameters<typeof importGmRoster>[0]),
    onSuccess: (r) => {
      toast.push(`Merged ${r.upserted} store${r.upserted === 1 ? "" : "s"} into the roster.`, "success");
      qc.invalidateQueries({ queryKey: ["gm-roster"] });
      onClose();
    },
    onError: (e: unknown) => toast.push(e instanceof Error ? e.message : "Import failed.", "error"),
  });

  const hasUpload = uploads.length > 0;

  return (
    <Modal open onClose={onClose} title="Import GM roster" maxWidth="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">{accepted.size} to merge · {changed.length} changed · {news.length} not in roster · {unchanged} unchanged</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => mut.mutate()} disabled={!accepted.size || mut.isPending}>
              {mut.isPending ? "Merging…" : `Merge ${accepted.size} store${accepted.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      }>
      <p className="mb-3 text-xs text-zinc-500">
        Upload the roster file (.xlsx or .csv) or paste it — columns are auto-detected (Store #, GM, Date of Hire,
        Date of Placement, GM Cell, GM Birthday, Store Email). Stores whose data <strong>differs</strong> from the
        current roster are flagged below; accept to merge (only the uploaded fields overwrite) or decline to keep what's there.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" /> Choose file (.xlsx / .csv)
        </Button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        {fileName && <span className="text-xs text-zinc-500">{fileName}</span>}
      </div>

      {!hasUpload && (
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          onBlur={() => paste.trim() && load(parsePaste(paste))}
          rows={6}
          placeholder="…or paste rows (with a header row) here"
          className="w-full resize-y rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-800 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      )}

      {hasUpload && (
        <div className="max-h-[52vh] space-y-4 overflow-y-auto">
          {changed.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">{changed.length} store(s) differ from the roster</span>
                <span className="flex gap-2 text-[11px]">
                  <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setAll(changed, true)}>Accept all</button>
                  <button type="button" className="font-semibold text-zinc-400 hover:underline" onClick={() => setAll(changed, false)}>Decline all</button>
                </span>
              </div>
              <ul className="space-y-2">
                {changed.map((d) => <DiffCard key={d.store_number} d={d} on={accepted.has(d.store_number)} toggle={() => toggle(d.store_number)} />)}
              </ul>
            </div>
          )}

          {news.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{news.length} store(s) not in the current roster</div>
              <ul className="space-y-1.5">
                {news.map((d) => (
                  <li key={d.store_number} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-200">
                    <span><span className="font-mono font-semibold text-midnight">#{d.store_number}</span> <span className="text-zinc-500">{d.values.gm_name ?? d.values.store_name ?? "new"}</span></span>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-500"><input type="checkbox" checked={accepted.has(d.store_number)} onChange={() => toggle(d.store_number)} /> Add anyway</label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unchanged > 0 && <div className="text-xs text-zinc-400">{unchanged} store(s) already match — nothing to merge.</div>}
          {changed.length === 0 && news.length === 0 && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">Everything in the upload matches the current roster.</div>}
        </div>
      )}
    </Modal>
  );
}

function DiffCard({ d, on, toggle }: { d: DiffRow; on: boolean; toggle: () => void }) {
  return (
    <li className={cn("rounded-lg p-3 ring-1 ring-inset", on ? "bg-white ring-amber-200" : "bg-zinc-50 ring-zinc-200 opacity-70")}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-sm"><span className="font-mono font-semibold text-midnight">#{d.store_number}</span> <span className="text-zinc-500">{d.store_name}</span></span>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600"><input type="checkbox" checked={on} onChange={toggle} /> {on ? "Merge" : "Declined"}</label>
      </div>
      <ul className="space-y-0.5">
        {d.changes.map((c) => {
          const isDate = c.field === "hire_date" || c.field === "placement_date" || c.field === "gm_birthday";
          return (
            <li key={c.field} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="w-24 shrink-0 text-zinc-400">{c.label}</span>
              <span className="text-zinc-400 line-through">{c.from ? (isDate ? fmtDate(c.from) : c.from) : "—"}</span>
              <span className="text-zinc-400">→</span>
              <span className="font-semibold text-amber-800">{isDate ? fmtDate(c.to) : c.to}</span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
