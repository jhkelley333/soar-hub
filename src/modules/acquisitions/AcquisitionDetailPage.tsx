// /admin/acquisitions/:id — upload the acquired stores, review/fix them, then
// merge them live (creates active stores + any missing region/area/district).
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Upload, Rocket, RotateCcw, Trash2, Pencil, AlertTriangle, CheckCircle2, MapPin, Download, FileDown } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Modal } from "@/shared/ui/Modal";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { useToast } from "@/shared/ui/Toaster";
import { cn } from "@/lib/cn";
import { deleteAcquisition, deleteStore, fetchAcquisition, fetchOrgOptions, geocodeAcquisition, mergeAcquisition, unmergeAcquisition, updateStore, uploadStores, type AcqStore, type OrgOptions } from "./api";
import { parseAcquisitionPaste, parseAcquisitionXlsx } from "./acquisitionImport";
import { downloadAcquisitionData, downloadAcquisitionTemplate } from "./acquisitionsWorkbook";

export function AcquisitionDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ["acquisition", id], queryFn: () => fetchAcquisition(id), enabled: !!id });
  const [paste, setPaste] = useState("");
  const [editing, setEditing] = useState<AcqStore | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: { store_number: string; reason: string }[] } | null>(null);

  const acq = q.data?.acquisition;
  const stores = q.data?.stores ?? [];
  const summary = q.data?.summary;
  const merged = acq?.status === "merged";
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["acquisition", id] }); qc.invalidateQueries({ queryKey: ["acquisitions"] }); };

  const upload = useMutation({
    mutationFn: (rows: Parameters<typeof uploadStores>[1]) => uploadStores(id, rows),
    onSuccess: (r) => { toast.push(`Staged ${r.staged} stores.`, "success"); setPaste(""); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Upload failed.", "error"),
  });
  const onFile = async (f: File) => {
    try {
      const rows = f.name.toLowerCase().endsWith(".xlsx") ? await parseAcquisitionXlsx(f) : parseAcquisitionPaste(await f.text());
      if (!rows.length) return toast.push("No rows with a store number found — check the headers.", "error");
      upload.mutate(rows);
    } catch (e) { toast.push(e instanceof Error ? e.message : "Couldn't read that file.", "error"); }
  };

  const merge = useMutation({
    mutationFn: () => mergeAcquisition(id),
    onSuccess: (r) => { setResult({ created: r.created, skipped: r.skipped }); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Merge failed.", "error"),
  });
  const unmerge = useMutation({
    mutationFn: () => unmergeAcquisition(id),
    onSuccess: (r) => { toast.push(`Deactivated ${r.deactivated} stores.`, "success"); invalidate(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Un-merge failed.", "error"),
  });
  const geocode = useMutation({
    mutationFn: async () => {
      let total = 0;
      for (let i = 0; i < 60; i++) {
        const r = await geocodeAcquisition(id);
        total += r.geocoded;
        if (r.remaining <= 0 || r.geocoded === 0) break;
      }
      return total;
    },
    onSuccess: (n) => toast.push(n ? `Geocoded ${n} store(s) for the map.` : "All stores already geocoded.", "success"),
    onError: (e) => toast.push(e instanceof Error ? e.message : "Geocoding failed.", "error"),
  });
  const removeAcq = useMutation({
    mutationFn: () => deleteAcquisition(id),
    onSuccess: () => { toast.push("Acquisition deleted.", "success"); qc.invalidateQueries({ queryKey: ["acquisitions"] }); nav("/admin/acquisitions"); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't delete.", "error"),
  });

  return (
    <div>
      <button type="button" onClick={() => nav("/admin/acquisitions")} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-midnight">
        <ArrowLeft className="h-4 w-4" /> Acquisitions
      </button>

      {q.isLoading && <Skeleton className="h-96 w-full" />}
      {q.isError && <EmptyState title="Couldn't load" description={(q.error as Error)?.message ?? "Try again."} />}

      {acq && (
        <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-midnight">{acq.name}</h2>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", merged ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{merged ? "Merged" : "Draft"}</span>
              </div>
              {acq.close_date && <div className="mt-0.5 text-sm text-zinc-500">Closes {new Date(`${acq.close_date}T12:00:00`).toLocaleDateString("en-US")}</div>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => downloadAcquisitionTemplate()} title="Download the upload template">
                <FileDown className="mr-1.5 h-3.5 w-3.5" /> Template
              </Button>
              {stores.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => downloadAcquisitionData(acq.name, stores)} title="Download the current staged stores to edit and re-upload">
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download data
                </Button>
              )}
              {!merged && summary && (
                <Button size="sm" disabled={summary.mergeable === 0 || merge.isPending}
                  onClick={() => { if (window.confirm(`Merge ${summary.mergeable} store(s) live? This creates active stores and any missing region/area/district. Blocked rows are skipped.`)) merge.mutate(); }}>
                  <Rocket className="mr-1.5 h-3.5 w-3.5" /> {merge.isPending ? "Merging…" : `Merge ${summary.mergeable} live`}
                </Button>
              )}
              {merged && (
                <Button variant="secondary" size="sm" disabled={geocode.isPending} onClick={() => geocode.mutate()}
                  title="Geocode the merged stores' addresses so they pin on the Territory Map">
                  <MapPin className="mr-1.5 h-3.5 w-3.5" /> {geocode.isPending ? "Geocoding…" : "Geocode addresses"}
                </Button>
              )}
              {merged && (
                <Button variant="secondary" size="sm" disabled={unmerge.isPending}
                  onClick={() => { if (window.confirm("Un-merge? This deactivates the stores this acquisition created (they disappear from the hub). Org nodes stay. Use if a deal fell through.")) unmerge.mutate(); }}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {unmerge.isPending ? "Un-merging…" : "Un-merge"}
                </Button>
              )}
              {!merged && (
                <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50"
                  onClick={() => { if (window.confirm("Delete this acquisition and its staged stores?")) removeAcq.mutate(); }}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </div>
          </div>

          {summary && (
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <Chip label={`${summary.total} staged`} />
              <Chip label={`${summary.mergeable} ready`} cls="bg-emerald-50 text-emerald-700 ring-emerald-200" />
              {summary.blocked > 0 && <Chip label={`${summary.blocked} blocked`} cls="bg-red-50 text-red-700 ring-red-200" />}
              {summary.merged > 0 && <Chip label={`${summary.merged} live`} cls="bg-sky-50 text-sky-700 ring-sky-200" />}
            </div>
          )}

          {!merged && (
            <Card className="mb-4 p-4">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Upload stores</div>
              <p className="mb-3 text-xs text-zinc-500">
                .xlsx or .csv — columns auto-detected: <strong>Store #, Name, Address, City, State, Zip, Store Email, Phone, Region, Area, District</strong>.
                Region + Area + District are required for a store to be mergeable (every store needs a district). GM assignments are added later (separate roster upload). Uploading replaces the current staged set.
              </p>
              <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                <strong>First create the new Region / Area / District in <a href="/admin/org" className="underline">Org Admin</a></strong>, then pick them from the dropdowns on each store below (edit a row). Merge assigns each store to the district you choose.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><Upload className="mr-1.5 h-3.5 w-3.5" /> Choose file</Button>
                <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
                <span className="text-xs text-zinc-400">or paste rows below</span>
              </div>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} onBlur={() => { if (paste.trim()) { const r = parseAcquisitionPaste(paste); if (r.length) upload.mutate(r); else toast.push("Couldn't find a store-number column.", "error"); } }}
                rows={3} placeholder="Paste rows with a header row (tab- or comma-separated)…" className="mt-2 w-full resize-y rounded-lg bg-zinc-50 p-3 font-mono text-xs ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent" />
            </Card>
          )}

          {stores.length === 0 ? (
            <EmptyState title="No stores staged" description={merged ? "This acquisition has no staged stores." : "Upload the acquired stores to get started."} />
          ) : (
            <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 text-left text-[10px] uppercase tracking-wide text-zinc-400">
                      <th className="px-3 py-2">Store</th><th className="px-3 py-2">Location</th><th className="px-3 py-2">Region › Area › District</th><th className="px-3 py-2">GM</th><th className="px-3 py-2">Status</th><th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {stores.map((s) => <StoreRow key={s.id} s={s} merged={merged} onEdit={() => setEditing(s)} onDelete={() => { if (window.confirm(`Remove #${s.store_number} from the staged set?`)) deleteStore(s.id).then(invalidate); }} />)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {editing && <EditStoreModal store={editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      {result && <MergeResultModal result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function StoreRow({ s, merged, onEdit, onDelete }: { s: AcqStore; merged: boolean; onEdit: () => void; onDelete: () => void }) {
  const org = [s.region_name, s.area_name, s.district_name].map((x) => x || "—").join(" › ");
  return (
    <tr className="align-top">
      <td className="px-3 py-2"><div className="font-semibold text-midnight">#{s.store_number}</div><div className="text-xs text-zinc-500">{s.name ?? ""}</div></td>
      <td className="px-3 py-2 text-xs text-zinc-600">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
      <td className="px-3 py-2 text-xs text-zinc-600">{org}</td>
      <td className="px-3 py-2 text-xs text-zinc-600">{s.gm_name ?? "—"}</td>
      <td className="px-3 py-2">
        {s.merged ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200"><CheckCircle2 className="h-3 w-3" /> Live</span>
        ) : s.issues.length ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-inset ring-red-200" title={s.issues.join("; ")}><AlertTriangle className="h-3 w-3" /> {s.issues[0]}</span>
        ) : (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Ready</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {!merged && !s.merged && (
          <div className="flex justify-end gap-1">
            <button type="button" onClick={onEdit} className="text-zinc-300 hover:text-accent"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={onDelete} className="text-zinc-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
      </td>
    </tr>
  );
}

function EditStoreModal({ store, onClose, onSaved }: { store: AcqStore; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const orgQ = useQuery({ queryKey: ["acquisition-org-options"], queryFn: fetchOrgOptions });
  const [f, setF] = useState({
    store_number: store.store_number, name: store.name ?? "",
    address: store.address ?? "", city: store.city ?? "", state: store.state ?? "", zip: store.zip ?? "",
    store_email: store.store_email ?? "", phone: store.phone ?? "",
    region_name: store.region_name ?? "", area_name: store.area_name ?? "", district_name: store.district_name ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => updateStore(store.id, f),
    onSuccess: () => { toast.push("Saved.", "success"); onSaved(); onClose(); },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Couldn't save.", "error"),
  });
  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";
  const textFields: { label: string; k: keyof typeof f; span?: boolean }[] = [
    { label: "Store #", k: "store_number" }, { label: "Name", k: "name" },
    { label: "Address", k: "address", span: true },
    { label: "City", k: "city" }, { label: "State", k: "state" }, { label: "Zip", k: "zip" },
    { label: "Store email", k: "store_email" }, { label: "Phone", k: "phone" },
  ];
  return (
    <Modal open onClose={onClose} title={`Edit #${store.store_number}`} maxWidth="max-w-lg"
      footer={<><Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        {textFields.map(({ label, k, span }) => (
          <label key={k} className={cn("block", span && "col-span-3")}><span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">{label}</span><input value={f[k]} onChange={set(k)} className={cls} /></label>
        ))}
      </div>
      <OrgPickers options={orgQ.data} value={{ region: f.region_name, area: f.area_name, district: f.district_name }}
        onChange={(v) => setF((p) => ({ ...p, region_name: v.region, area_name: v.area, district_name: v.district }))} />
      <p className="mt-3 text-[11px] text-zinc-400">Region → Area → District come from Org Admin. Create them there first if they're missing.</p>
    </Modal>
  );
}

// Cascading Region → Area → District selects sourced from the existing org tree.
// Each level filters the next; the currently-saved value stays selectable even
// if it isn't in the tree (so an uploaded name isn't silently dropped).
function OrgPickers({ options, value, onChange }: {
  options: OrgOptions | undefined;
  value: { region: string; area: string; district: string };
  onChange: (v: { region: string; area: string; district: string }) => void;
}) {
  const regions = options?.regions ?? [];
  const region = regions.find((r) => r.name === value.region) || null;
  const areas = (options?.areas ?? []).filter((a) => region && a.region_id === region.id);
  const area = areas.find((a) => a.name === value.area) || null;
  const districts = (options?.districts ?? []).filter((d) => area && d.area_id === area.id);

  const withCurrent = (list: { name: string }[], cur: string) =>
    cur && !list.some((x) => x.name === cur) ? [{ name: cur }, ...list] : list;

  const cls = "w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none disabled:bg-zinc-50";
  return (
    <div className="mt-3 grid grid-cols-3 gap-3">
      <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">Region</span>
        <select value={value.region} onChange={(e) => onChange({ region: e.target.value, area: "", district: "" })} className={cls}>
          <option value="">— select —</option>
          {withCurrent(regions, value.region).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
        </select>
      </label>
      <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">Area</span>
        <select value={value.area} disabled={!value.region} onChange={(e) => onChange({ region: value.region, area: e.target.value, district: "" })} className={cls}>
          <option value="">— select —</option>
          {withCurrent(areas, value.area).map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select>
      </label>
      <label className="block"><span className="mb-0.5 block text-[11px] font-semibold text-zinc-500">District</span>
        <select value={value.district} disabled={!value.area} onChange={(e) => onChange({ region: value.region, area: value.area, district: e.target.value })} className={cls}>
          <option value="">— select —</option>
          {withCurrent(districts, value.district).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
        </select>
      </label>
    </div>
  );
}

function MergeResultModal({ result, onClose }: { result: { created: number; skipped: { store_number: string; reason: string }[] }; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Merge complete" maxWidth="max-w-md"
      footer={<Button size="sm" onClick={onClose}>Done</Button>}>
      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-200">
        {result.created} store{result.created === 1 ? "" : "s"} went live across the hub.
      </div>
      {result.skipped.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-red-700">{result.skipped.length} skipped</div>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {result.skipped.map((s, i) => <li key={i} className="rounded bg-zinc-50 px-2 py-1 ring-1 ring-inset ring-zinc-100"><span className="font-mono font-semibold">#{s.store_number}</span> — {s.reason}</li>)}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function Chip({ label, cls }: { label: string; cls?: string }) {
  return <span className={cn("rounded-full px-3 py-1 font-semibold ring-1 ring-inset", cls || "bg-white text-zinc-600 ring-zinc-200")}>{label}</span>;
}
