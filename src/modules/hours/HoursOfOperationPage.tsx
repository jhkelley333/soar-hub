// Hours of Operation — main grid. Every active store × 7 weekday columns of
// standard hours. Search + Open/Pending filter; click a row to edit that
// location (standard + special hours). Admin-gated in the router.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Search, CalendarClock, Download, Upload, MapPin, AlertTriangle, ClipboardList, Signpost } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { fetchHoursGrid, checkAllGoogle, fetchReconciliationList, type HoursGridStore } from "./api";
import { DAY_LABELS, fmtRange } from "./hoursFmt";
import { downloadHoursWorkbook, downloadReconWorkbook } from "./hoursWorkbook";
import { HoursImportModal } from "./HoursImportModal";

type Filter = "open" | "pending";

// Mon..Sun dates for the current week (for the column sub-labels, like the ref UI).
function weekDates(): { dow: string; d: number; mon: string }[] {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0=Mon
  const monday = new Date(now); monday.setDate(now.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    return { dow: DAY_LABELS[i], d: dt.getDate(), mon: dt.toLocaleDateString("en-US", { month: "short", year: "numeric" }).toUpperCase() };
  });
}

export function HoursOfOperationPage() {
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const query = useQuery({ queryKey: ["hours-grid"], queryFn: fetchHoursGrid });
  const cols = useMemo(() => weekDates(), []);
  const knownNumbers = useMemo(() => new Set((query.data?.stores ?? []).map((s) => s.number)), [query.data]);

  const all = query.data?.stores ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((s) => (filter === "open" ? s.configured : !s.configured))
      .filter((s) => !needle || s.number.toLowerCase().includes(needle) || (s.name ?? "").toLowerCase().includes(needle) || (s.address ?? "").toLowerCase().includes(needle) || (s.city ?? "").toLowerCase().includes(needle));
  }, [all, q, filter]);

  const openCount = all.filter((s) => s.configured).length;
  const pendingCount = all.length - openCount;
  const placesOn = query.data?.places_configured ?? false;
  const canImport = query.data?.can_import ?? false;
  const mismatchCount = all.filter((s) => s.google_status === "mismatch").length;

  // Loop the time-budgeted Google check until nothing's left to refresh.
  const checkGoogle = useMutation({
    mutationFn: async () => {
      // A fixed sweep-start timestamp, held across the paged loop: every store
      // is re-checked once this run (force re-resolves the Google place too), and
      // the loop converges as each store's checked_at moves past `since`.
      const since = new Date().toISOString();
      let checked = 0, failed = 0, calls = 0;
      for (;;) {
        const r = await checkAllGoogle({ since, force: true });
        checked += r.checked; failed += r.failed; calls += 1;
        if (r.remaining <= 0 || calls >= 80 || r.checked === 0) break;
      }
      return { checked, failed };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["hours-grid"] });
      toast.push(`Checked ${r.checked} location(s) against Google${r.failed ? ` · ${r.failed} with no listing/hours` : ""}.`, "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Google check failed.", "error"),
  });

  const exportXlsx = async () => {
    if (!filtered.length) { toast.push("Nothing to export for this view.", "error"); return; }
    setExporting(true);
    try {
      await downloadHoursWorkbook(filtered, filter === "open" ? "Open Locations" : "Pending Locations");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Export failed.", "error");
    } finally {
      setExporting(false);
    }
  };

  const exportRecon = async (kind: "itsacheckmate" | "sign") => {
    try {
      const { rows } = await fetchReconciliationList();
      const rowsFor = rows.filter((r) => (kind === "itsacheckmate" ? r.itsacheckmate_open : r.sign_open));
      if (!rowsFor.length) { toast.push(kind === "itsacheckmate" ? "No stores currently need an Itsacheckmate update." : "No signs currently need ordering.", "error"); return; }
      await downloadReconWorkbook(rowsFor, kind);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Export failed.", "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Hours of Operation"
        description="Standard weekly hours for every location. Click a location to edit its hours."
        actions={
          <div className="flex items-center gap-2">
            {placesOn && (
              <Button variant="secondary" size="sm" onClick={() => checkGoogle.mutate()} disabled={checkGoogle.isPending || !openCount}
                title="Fetch each location's hours from Google and flag mismatches">
                <MapPin className="mr-1.5 h-3.5 w-3.5" /> {checkGoogle.isPending ? "Checking Google…" : "Check Google"}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => exportRecon("itsacheckmate")} title="Download stores needing an Itsacheckmate hours update">
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Itsacheckmate list
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportRecon("sign")} title="Download stores needing a new hours sign">
              <Signpost className="mr-1.5 h-3.5 w-3.5" /> Signs to order
            </Button>
            {canImport && (
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload hours
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={exportXlsx} disabled={exporting || !all.length}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> {exporting ? "Exporting…" : "Download Excel"}
            </Button>
          </div>
        }
      />

      <HoursImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        knownNumbers={knownNumbers}
        onImported={() => qc.invalidateQueries({ queryKey: ["hours-grid"] })}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-full ring-1 ring-zinc-200">
          {([["open", "Open Locations", openCount], ["pending", "Pending Locations", pendingCount]] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn("px-4 py-1.5 text-sm font-semibold transition", filter === key ? "bg-accent text-white" : "bg-white text-zinc-600 hover:bg-zinc-50")}
            >
              {label} <span className="tabular-nums opacity-70">· {count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by location, address…"
            className="w-72 rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-midnight focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {query.data && (mismatchCount > 0 || !placesOn) && (
        <div className={cn("mb-4 flex items-start gap-2 rounded-lg p-3 text-sm ring-1 ring-inset",
          mismatchCount > 0 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-zinc-50 text-zinc-500 ring-zinc-200")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {mismatchCount > 0 ? (
            <span><strong>{mismatchCount} location(s)</strong> don't match Google. Open a flagged location to see which days differ.</span>
          ) : (
            <span>Set <code className="rounded bg-white px-1">GOOGLE_PLACES_API_KEY</code> in Netlify to compare each location's hours against Google.</span>
          )}
        </div>
      )}

      {query.isLoading && <Skeleton className="h-96 w-full" />}
      {query.isError && <EmptyState title="Couldn't load hours" description={(query.error as Error)?.message ?? "Try again."} />}

      {query.data && filtered.length === 0 && (
        <EmptyState
          title={filter === "open" ? "No locations with hours yet" : "No pending locations"}
          description={filter === "open" ? "Locations with saved standard hours will appear here." : "Every location has hours configured."}
        />
      )}

      {query.data && filtered.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50/60 text-left">
                <tr>
                  <th className="sticky left-0 z-10 bg-zinc-50/60 px-4 py-3 font-bold text-zinc-500">Location</th>
                  {cols.map((c) => (
                    <th key={c.dow} className="px-3 py-3 text-center font-semibold text-zinc-500">
                      <div className="text-[11px] uppercase tracking-wide">{c.dow}</div>
                      <div className="text-xs font-bold text-midnight">{c.d}</div>
                      <div className="text-[9.5px] text-zinc-400">{c.mon}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <GridRow key={s.id} s={s} onOpen={() => nav(`/admin/hours-of-operation/${encodeURIComponent(s.number)}`)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function GridRow({ s, onOpen }: { s: HoursGridStore; onOpen: () => void }) {
  return (
    <tr className="cursor-pointer border-t border-zinc-100 transition hover:bg-accent/[0.04]" onClick={onOpen}>
      <td className="sticky left-0 z-10 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-midnight">{s.number}</span>
          {s.google_status === "mismatch" && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title={`${s.google_diffs} day(s) differ from Google`}>
              <AlertTriangle className="h-3 w-3" />Google ≠ {s.google_diffs}
            </span>
          )}
          {s.google_status === "not_found" && (
            <span className="text-[10px] font-medium text-zinc-400" title="No Google listing/hours found">No Google match</span>
          )}
          {s.itsacheckmate_open && (
            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700" title="Itsacheckmate update needed">ICM</span>
          )}
          {s.sign_open && (
            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700" title="New hours sign needs ordering">Sign</span>
          )}
          {s.recon_status === "resolved" && (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title="Reconciliation resolved">✓</span>
          )}
          {s.upcoming_special > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600" title={`${s.upcoming_special} upcoming special hours`}>
              <CalendarClock className="h-3 w-3" />{s.upcoming_special}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          {[s.address, s.city, s.state].filter(Boolean).join(", ")}{s.zip ? ` ${s.zip}` : ""}
        </div>
      </td>
      {s.days.map((d, i) => (
        <td key={i} className={cn("px-3 py-3 text-center tabular-nums", d?.is_closed ? "text-red-500" : d ? "text-zinc-700" : "text-zinc-300")}>
          {fmtRange(d)}
        </td>
      ))}
    </tr>
  );
}
