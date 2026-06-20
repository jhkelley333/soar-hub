// Record off-ticket work — a job a store had done without a work order. DO+
// only. Captures the store, what was done, the vendor, service date, cost, and
// the invoice (required), then files it as a completed work order so the vendor
// + cost land in history and (optionally) become the store's go-to for that
// category. Mirrors the ReasonModal/NewTicketModal overlay + shared UI.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { VendorSearchInput } from "./VendorSearchInput";
import { fetchCallerStores, fetchIssueLibrary, fileToBase64, logOfflineWork } from "./api";

const RESOLUTION_OPTIONS = [
  { value: "repaired", label: "Repaired" },
  { value: "replaced", label: "Replaced" },
  { value: "no_issue_found", label: "No issue found" },
  { value: "deferred", label: "Deferred" },
];

export function LogWorkModal({
  open, onClose, onLogged, onError,
}: {
  open: boolean;
  onClose: () => void;
  onLogged: (woNumber: string) => void;
  onError: (msg: string) => void;
}) {
  const storesQ = useQuery({ queryKey: ["wo2", "callerStores"], queryFn: fetchCallerStores, enabled: open });
  const libQ = useQuery({ queryKey: ["wo2", "issueLibrary"], queryFn: fetchIssueLibrary, enabled: open });

  const [storeNumber, setStoreNumber] = useState("");
  const [category, setCategory] = useState("");
  const [assetType, setAssetType] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState("");
  const [description, setDescription] = useState("");
  const [resolution, setResolution] = useState("repaired");
  const [invoice, setInvoice] = useState<File | null>(null);
  const [setPreferred, setSetPreferred] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const stores = storesQ.data?.stores ?? [];
  // Auto-select when the caller has exactly one store.
  useEffect(() => {
    if (open && stores.length === 1 && !storeNumber) setStoreNumber(stores[0].number);
  }, [open, stores, storeNumber]);

  // Reset on close so the next open is clean.
  useEffect(() => {
    if (open) return;
    setStoreNumber(""); setCategory(""); setAssetType(""); setModelNumber("");
    setVendorName(""); setVendorId(null); setServiceDate(new Date().toISOString().slice(0, 10));
    setCost(""); setDescription(""); setResolution("repaired"); setInvoice(null);
    setSetPreferred(true); setSubmitting(false);
  }, [open]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of libQ.data?.items ?? []) if (it.category) set.add(it.category);
    return [...set].sort();
  }, [libQ.data]);

  const selectedStore = stores.find((s) => s.number === storeNumber);

  if (!open) return null;

  const canSubmit =
    !!storeNumber && !!vendorName.trim() && !!serviceDate && !!description.trim() && !!invoice && !submitting;

  async function handleSubmit() {
    if (!invoice) return;
    setSubmitting(true);
    try {
      const data = await fileToBase64(invoice);
      const res = await logOfflineWork({
        storeNumber,
        storeId: selectedStore?.id,
        storeName: selectedStore?.name,
        category: category || undefined,
        assetType: assetType.trim() || undefined,
        modelNumber: modelNumber.trim() || undefined,
        vendorName: vendorName.trim(),
        vendorId,
        serviceDate,
        cost: cost.trim() ? Number(cost) : null,
        description: description.trim(),
        resolutionCategory: resolution,
        setPreferred: setPreferred && !!vendorId && !!category,
        invoice: { data, name: invoice.name, type: invoice.type || "application/octet-stream" },
      });
      onLogged(res.woNumber);
    } catch (e) {
      onError((e as Error)?.message || "Couldn't record the work.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">Record completed work</div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600">
            For work a store had done <strong>without a ticket</strong>. This files a completed
            work order with the invoice so the vendor and cost are on record.
          </p>

          <div>
            <Label htmlFor="lw-store">Store *</Label>
            {stores.length === 1 ? (
              <div className="mt-1 text-sm text-midnight">#{stores[0].number}{stores[0].name ? ` — ${stores[0].name}` : ""}</div>
            ) : (
              <select
                id="lw-store"
                value={storeNumber}
                onChange={(e) => setStoreNumber(e.target.value)}
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Select a store…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.number}>#{s.number}{s.name ? ` — ${s.name}` : ""}</option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lw-category">Category</Label>
              <select
                id="lw-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">—</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="lw-asset">Equipment / asset</Label>
              <Input id="lw-asset" value={assetType} onChange={(e) => setAssetType(e.target.value)} placeholder="e.g. Walk-in cooler" />
            </div>
          </div>

          <div>
            <Label htmlFor="lw-vendor">Vendor *</Label>
            {storeNumber ? (
              <VendorSearchInput
                id="lw-vendor"
                storeNumber={storeNumber}
                value={vendorName}
                vendorId={vendorId}
                onChange={({ name, id }) => { setVendorName(name); setVendorId(id); }}
                placeholder="Search vendors or type a one-off name…"
              />
            ) : (
              <Input id="lw-vendor" value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="Pick a store first" disabled />
            )}
            <div className="mt-1 text-[10px] text-zinc-500">Pick from the list to link the vendor (needed to set them as preferred).</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lw-date">Service date *</Label>
              <Input id="lw-date" type="date" value={serviceDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setServiceDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lw-cost">Invoice total</Label>
              <Input id="lw-cost" type="number" inputMode="decimal" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
            </div>
          </div>

          <div>
            <Label htmlFor="lw-desc">What was done? *</Label>
            <textarea
              id="lw-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Brief summary of the work performed."
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lw-resolution">Outcome</Label>
              <select
                id="lw-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {RESOLUTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="lw-model">Model # (optional)</Label>
              <Input id="lw-model" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} placeholder="From the spec plate" />
            </div>
          </div>

          <div>
            <Label htmlFor="lw-invoice">Invoice *</Label>
            <input
              id="lw-invoice"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setInvoice(e.target.files?.[0] || null)}
              className="block w-full text-sm text-zinc-700 file:mr-2 file:rounded-md file:border-0 file:bg-accent/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-midnight hover:file:bg-accent/20"
            />
            {invoice && (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                <span className="truncate font-mono">{invoice.name}</span>
                <span>({(invoice.size / 1024).toFixed(0)} KB)</span>
                <button type="button" onClick={() => setInvoice(null)} className="text-red-600 hover:underline">remove</button>
              </div>
            )}
          </div>

          <label className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${vendorId && category ? "border-accent/30 bg-accent/5 text-zinc-700" : "border-zinc-200 bg-zinc-50 text-zinc-400"}`}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-accent"
              checked={setPreferred}
              disabled={!vendorId || !category}
              onChange={(e) => setSetPreferred(e.target.checked)}
            />
            <span>
              Set this vendor as the store's go-to for <strong>{category || "this category"}</strong>, so the next ticket suggests them.
              {(!vendorId || !category) && <span className="block text-[10px]">Pick a saved vendor and a category to enable.</span>}
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Record work
          </Button>
        </div>
      </div>
    </div>
  );
}
