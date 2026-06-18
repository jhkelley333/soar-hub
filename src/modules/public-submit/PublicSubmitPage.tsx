// Public, unauthenticated ticket-submission page mounted at /submit.
// Mirrors the WO2 NewTicketModal where it makes sense (issue library
// typeahead, model number, photos, troubleshooting prompt) and
// intentionally drops the vendor picker + warranty hints, which are
// operational data not meant for public eyes.
//
// Flow:
//   1. Search for a store by number or name (typeahead, debounced)
//   2. Enter name + email (required) and phone (optional)
//   3. Find the issue via library typeahead OR fall back to category
//      dropdown + free-text equipment
//   4. Pick a priority, describe the issue, optionally answer the
//      troubleshooting question, optionally attach up to 3 photos
//   5. Submit → create ticket → upload photos in parallel → success
//
// Photo guards live server-side: max 3 per ticket, 5 MB each, 15-min
// upload window from ticket creation. The UI matches but the server
// is the real gate.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ImagePlus,
  Loader2,
  MapPin,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card, CardBody } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { cn } from "@/lib/cn";

const FN = "/.netlify/functions/public-submit";

interface StoreHit {
  id: string;
  number: string;
  name: string | null;
}

interface IssueLibraryHit {
  id: string;
  category: string;
  asset_type: string;
  display_name: string;
  troubleshooting_tips: string | null;
}

interface VendorHit {
  id: string;
  name: string;
  category: string;
  phone?: string | null;
}

interface SubmitResult {
  id: string;
  wo_number: string;
  store_number: string;
  store_name: string | null;
  photos_uploaded: number;
  photos_failed: number;
}

interface PhotoSlot {
  id: string;
  file: File;
  previewUrl: string;
}

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result || "");
      // result is "data:<mime>;base64,<payload>" — strip the prefix.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export function PublicSubmitPage() {
  // ── Store search ──
  const [storeQuery, setStoreQuery] = useState("");
  const [storeHits, setStoreHits] = useState<StoreHit[]>([]);
  const [storeSearchOpen, setStoreSearchOpen] = useState(false);
  const [searchingStore, setSearchingStore] = useState(false);
  const [pickedStore, setPickedStore] = useState<StoreHit | null>(null);

  // ── Contact info ──
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // ── Issue ──
  const [issueQuery, setIssueQuery] = useState("");
  const [issueHits, setIssueHits] = useState<IssueLibraryHit[]>([]);
  const [issueSearchOpen, setIssueSearchOpen] = useState(false);
  const [searchingIssue, setSearchingIssue] = useState(false);
  // Picked from the library, OR a synthetic "Other" entry (id "__other__")
  // built from the typed text when the issue isn't in the library.
  const [pickedIssue, setPickedIssue] = useState<IssueLibraryHit | null>(null);
  const [modelNumber, setModelNumber] = useState("");
  const [priority, setPriority] = useState<"Standard" | "Urgent" | "Emergency">("Standard");
  const [issueDescription, setIssueDescription] = useState("");
  const [troubleshooting, setTroubleshooting] = useState<"" | "yes" | "no">("");

  // ── Vendor preference (optional) ──
  // Loaded once a store is picked. Re-loads whenever the effective
  // category changes so the list narrows as the submitter zeroes in
  // on the issue. Server applies the same scope-filtering WO2 uses,
  // and re-validates the chosen vendor_id at submit time.
  const [vendors, setVendors] = useState<VendorHit[]>([]);
  const [loadingVendors, setLoadingVendors] = useState(false);
  // Vendor entry mirrors the WO2 New Ticket modal: recommendations
  // populate from the picked equipment; the submitter can pick one or
  // type a one-off name. needsHelp flags it for the DO to assign.
  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorSearchOpen, setVendorSearchOpen] = useState(false);
  const [vendorSearchQ, setVendorSearchQ] = useState("");
  const [needsHelp, setNeedsHelp] = useState(false);

  // ── Photos ──
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Submission state ──
  const [submitting, setSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"" | "ticket" | "photos">("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Category + asset come straight from the picked issue (the library
  // pick or the synthetic "Other"). The standalone Category/Asset fields
  // were removed — the issue picker already carries that data.
  const effectiveCategory = pickedIssue?.category || "";
  const effectiveAssetType = pickedIssue?.display_name || "";

  // Top suggestions (the list is already equipment-floated server-side)
  // shown as cards, plus a searchable "all vendors" list.
  const recommendedVendors = useMemo(() => vendors.slice(0, 4), [vendors]);
  const vendorSearchResults = useMemo(() => {
    const q = vendorSearchQ.trim().toLowerCase();
    const base = q
      ? vendors.filter((v) => `${v.name} ${v.category}`.toLowerCase().includes(q))
      : vendors;
    return base.slice(0, 30);
  }, [vendors, vendorSearchQ]);

  // Debounced store typeahead (250ms).
  useEffect(() => {
    if (pickedStore) return;
    const q = storeQuery.trim();
    if (q.length < 2) {
      setStoreHits([]);
      return;
    }
    setSearchingStore(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${FN}?action=searchStores&q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => ({}));
        setStoreHits(body.ok && Array.isArray(body.stores) ? body.stores : []);
      } catch {
        setStoreHits([]);
      } finally {
        setSearchingStore(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [storeQuery, pickedStore]);

  // Debounced issue-library typeahead.
  useEffect(() => {
    if (pickedIssue) return;
    const q = issueQuery.trim();
    if (q.length < 2) {
      setIssueHits([]);
      return;
    }
    setSearchingIssue(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${FN}?action=searchIssueLibrary&q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => ({}));
        setIssueHits(body.ok && Array.isArray(body.items) ? body.items : []);
      } catch {
        setIssueHits([]);
      } finally {
        setSearchingIssue(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [issueQuery, pickedIssue]);

  // Load store-scoped vendor list whenever the picked store or
  // effective category changes. Clears the current pick if it's no
  // longer in the filtered list so the submit body never carries a
  // stale id.
  useEffect(() => {
    if (!pickedStore) {
      setVendors([]);
      return;
    }
    setLoadingVendors(true);
    const params = new URLSearchParams({ store_number: pickedStore.number });
    if (effectiveCategory) params.set("category", effectiveCategory);
    if (effectiveAssetType) params.set("asset_type", effectiveAssetType);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${FN}?action=listVendors&${params.toString()}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = body.ok && Array.isArray(body.vendors) ? body.vendors : [];
        setVendors(list);
        // Drop a recommended-vendor id that's no longer in the refreshed
        // list; leave any typed name + the need-help flag alone.
        setVendorId((prev) => (prev && list.some((v: VendorHit) => v.id === prev) ? prev : ""));
      } catch {
        if (!cancelled) setVendors([]);
      } finally {
        if (!cancelled) setLoadingVendors(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickedStore, effectiveCategory, effectiveAssetType]);

  // Revoke object URLs on unmount so we don't leak.
  useEffect(() => {
    return () => {
      for (const p of photos) URL.revokeObjectURL(p.previewUrl);
    };
  }, [photos]);

  // Vendor: a typed/picked name, or the explicit "need help" escalation.
  const vendorChosen = needsHelp || vendorName.trim().length > 0;
  const canSubmit =
    !!pickedStore
    && name.trim().length > 0
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && !!pickedIssue
    && issueDescription.trim().length >= 10
    && troubleshooting !== ""
    && vendorChosen
    && photos.length > 0
    && !submitting;

  function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    const accepted: PhotoSlot[] = [];
    const rejected: string[] = [];
    for (let i = 0; i < files.length && accepted.length < remaining; i++) {
      const f = files[i];
      if (!f.type.startsWith("image/")) {
        rejected.push(`${f.name}: not an image`);
        continue;
      }
      if (f.size > MAX_PHOTO_BYTES) {
        rejected.push(`${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB exceeds 5 MB`);
        continue;
      }
      accepted.push({
        id: `${Date.now()}-${i}-${f.name}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
      });
    }
    if (accepted.length) setPhotos((prev) => [...prev, ...accepted]);
    if (rejected.length) {
      setSubmitError("Some photos couldn't be added: " + rejected.join("; "));
    } else {
      setSubmitError(null);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const out: PhotoSlot[] = [];
      for (const p of prev) {
        if (p.id === id) URL.revokeObjectURL(p.previewUrl);
        else out.push(p);
      }
      return out;
    });
  }

  async function submit() {
    if (!pickedStore) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitPhase("ticket");
    try {
      // The first photo is required and sent with creation so the server
      // binds it to the ticket; the rest upload after.
      const firstB64 = await fileToBase64(photos[0].file);
      const tRes = await fetch(`${FN}?action=createTicket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: pickedStore.id,
          submitter_name: name.trim(),
          submitter_email: email.trim(),
          submitter_phone: phone.trim(),
          category: effectiveCategory,
          asset_type: effectiveAssetType.trim(),
          model_number: modelNumber.trim(),
          issue_description: issueDescription.trim(),
          priority,
          troubleshooting_checked: troubleshooting === "yes",
          vendor_id: vendorId || null,
          vendor_name: vendorId ? undefined : vendorName.trim() || undefined,
          needs_vendor_help: needsHelp,
          photo: { photoData: firstB64, photoName: photos[0].file.name, photoType: photos[0].file.type },
        }),
      });
      const tBody = await tRes.json().catch(() => ({}));
      if (!tRes.ok || !tBody.ok) {
        throw new Error(tBody.message || `Submit failed (${tRes.status}).`);
      }
      const created = tBody.ticket;

      // The first photo was stored with creation; upload any others.
      let uploaded = 1;
      let failed = 0;
      if (photos.length > 1) {
        setSubmitPhase("photos");
        for (const slot of photos.slice(1)) {
          try {
            const b64 = await fileToBase64(slot.file);
            const pRes = await fetch(`${FN}?action=uploadPhoto`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ticket_id: created.id,
                photo_data: b64,
                photo_name: slot.file.name,
                photo_type: slot.file.type,
              }),
            });
            const pBody = await pRes.json().catch(() => ({}));
            if (pRes.ok && pBody.ok) uploaded++;
            else failed++;
          } catch {
            failed++;
          }
        }
      }

      setResult({
        id: created.id,
        wo_number: created.wo_number,
        store_number: created.store_number,
        store_name: created.store_name,
        photos_uploaded: uploaded,
        photos_failed: failed,
      });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setSubmitting(false);
      setSubmitPhase("");
    }
  }

  const submitButtonLabel = useMemo(() => {
    if (!submitting) return "Submit work order";
    if (submitPhase === "photos") return "Uploading photos…";
    return "Submitting…";
  }, [submitting, submitPhase]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2 text-base font-semibold tracking-tight text-midnight">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-6 w-6 rounded" />
          SOAR QSR — Submit Work Order
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-24">
        {result ? (
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
                <div className="text-base font-semibold">Submitted</div>
              </div>
              <p className="text-sm text-zinc-700">
                Your ticket has been filed. The store and our facilities team have been notified.
              </p>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                <div>
                  <span className="text-zinc-500">Work order:</span>{" "}
                  <span className="font-mono font-semibold text-midnight">{result.wo_number}</span>
                </div>
                <div className="mt-1">
                  <span className="text-zinc-500">Store:</span>{" "}
                  <span className="font-medium text-midnight">#{result.store_number}{result.store_name ? ` · ${result.store_name}` : ""}</span>
                </div>
                {(result.photos_uploaded > 0 || result.photos_failed > 0) && (
                  <div className="mt-1 text-xs text-zinc-600">
                    Photos: {result.photos_uploaded} attached
                    {result.photos_failed > 0 && (
                      <span className="text-amber-700">, {result.photos_failed} failed</span>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                Save your work order number for reference. To submit another, refresh this page.
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            <Card>
              <CardBody className="space-y-3">
                <div>
                  <Label htmlFor="ps-store">Which store?</Label>
                  {pickedStore ? (
                    <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-accent" strokeWidth={1.75} />
                        <span className="font-semibold text-midnight">#{pickedStore.number}</span>
                        {pickedStore.name && (
                          <span className="text-zinc-600">· {pickedStore.name}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedStore(null);
                          setStoreQuery("");
                          setStoreHits([]);
                          setStoreSearchOpen(true);
                        }}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Search className="h-4 w-4" strokeWidth={1.75} />
                      </div>
                      <Input
                        id="ps-store"
                        value={storeQuery}
                        onChange={(e) => {
                          setStoreQuery(e.target.value);
                          setStoreSearchOpen(true);
                        }}
                        onFocus={() => setStoreSearchOpen(true)}
                        placeholder="Search by store number or name…"
                        className="pl-8"
                        autoComplete="off"
                      />
                      {storeSearchOpen && storeQuery.trim().length >= 2 && (
                        <div className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg">
                          {searchingStore && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Searching…
                            </div>
                          )}
                          {!searchingStore && storeHits.length === 0 && (
                            <div className="px-3 py-2 text-xs text-zinc-500">No stores match.</div>
                          )}
                          {storeHits.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setPickedStore(s);
                                setStoreSearchOpen(false);
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                            >
                              <span className="font-semibold text-midnight">#{s.number}</span>
                              {s.name && <span className="ml-2 text-zinc-600">{s.name}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <div className="text-sm font-semibold tracking-tight text-midnight">Your contact info</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ps-name">Name</Label>
                    <Input
                      id="ps-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ps-email">Email</Label>
                    <Input
                      id="ps-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@example.com"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ps-phone">Phone (optional)</Label>
                    <Input
                      id="ps-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="555-555-1234"
                    />
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <div className="text-sm font-semibold tracking-tight text-midnight">What's the issue?</div>

                <div>
                  <Label htmlFor="ps-issue">
                    Find the issue <span className="text-red-500">*</span>
                  </Label>
                  {pickedIssue ? (
                    <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2">
                      <div className="text-sm">
                        <div className="font-semibold text-midnight">{pickedIssue.display_name}</div>
                        <div className="text-xs text-zinc-500">
                          {pickedIssue.id === "__other__"
                            ? "Other — not in the list"
                            : `${pickedIssue.category} · ${pickedIssue.asset_type}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedIssue(null);
                          setIssueQuery("");
                          setIssueHits([]);
                          setIssueSearchOpen(true);
                        }}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Search className="h-4 w-4" strokeWidth={1.75} />
                      </div>
                      <Input
                        id="ps-issue"
                        value={issueQuery}
                        onChange={(e) => {
                          setIssueQuery(e.target.value);
                          setIssueSearchOpen(true);
                        }}
                        onFocus={() => setIssueSearchOpen(true)}
                        placeholder="Start typing — e.g. fryer, walk-in, hood, POS…"
                        className="pl-8"
                        autoComplete="off"
                      />
                      {issueSearchOpen && issueQuery.trim().length >= 2 && (
                        <div className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg">
                          {searchingIssue && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Searching…
                            </div>
                          )}
                          {issueHits.map((i) => (
                            <button
                              key={i.id}
                              type="button"
                              onClick={() => {
                                setPickedIssue(i);
                                setIssueSearchOpen(false);
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                            >
                              <div className="font-semibold text-midnight">{i.display_name}</div>
                              <div className="text-[11px] text-zinc-500">{i.category} · {i.asset_type}</div>
                            </button>
                          ))}
                          {/* Always offer an "Other" fallback so a submitter
                              whose issue isn't in the library can still file. */}
                          <button
                            type="button"
                            onClick={() => {
                              setPickedIssue({
                                id: "__other__",
                                display_name: issueQuery.trim(),
                                category: "Other",
                                asset_type: issueQuery.trim(),
                                troubleshooting_tips: null,
                              });
                              setIssueSearchOpen(false);
                            }}
                            className="block w-full border-t border-zinc-100 px-3 py-2 text-left text-sm hover:bg-zinc-50"
                          >
                            <div className="font-semibold text-accent">Other — use “{issueQuery.trim()}”</div>
                            <div className="text-[11px] text-zinc-500">My issue isn't in the list</div>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="ps-model">Model number (optional)</Label>
                  <Input
                    id="ps-model"
                    value={modelNumber}
                    onChange={(e) => setModelNumber(e.target.value)}
                    placeholder="If you can see it on the equipment"
                  />
                </div>

                <div>
                  <Label>Priority</Label>
                  <div className="flex gap-2">
                    {(["Standard", "Urgent", "Emergency"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={cn(
                          "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                          priority === p
                            ? p === "Emergency" ? "border-red-500 bg-red-50 text-red-800"
                            : p === "Urgent"   ? "border-amber-500 bg-amber-50 text-amber-900"
                            : "border-accent bg-accent/10 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="ps-desc">Describe the issue</Label>
                  <textarea
                    id="ps-desc"
                    value={issueDescription}
                    onChange={(e) => setIssueDescription(e.target.value)}
                    rows={4}
                    minLength={10}
                    className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="What's wrong, where exactly, when did it start, any error codes or symptoms…"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Minimum 10 characters. The clearer the description, the faster we can route it.
                  </div>
                </div>

                {pickedIssue?.troubleshooting_tips && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <div className="mb-1 font-semibold uppercase tracking-wide">Try first</div>
                    <div className="whitespace-pre-line">{pickedIssue.troubleshooting_tips}</div>
                  </div>
                )}

                <div>
                  <Label htmlFor="ps-vendor">
                    Vendor Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="ps-vendor"
                    value={needsHelp ? "" : vendorName}
                    onChange={(e) => {
                      setVendorName(e.target.value);
                      setVendorId(""); // typing = free text, drop any picked id
                    }}
                    disabled={needsHelp || !pickedStore}
                    placeholder={
                      needsHelp
                        ? "Your DO will assign a vendor"
                        : !pickedStore
                        ? "Pick a store first…"
                        : "Search or select a vendor"
                    }
                    autoComplete="off"
                  />

                  {/* Suggested vendor cards — based on the picked equipment. */}
                  {!needsHelp && pickedIssue && recommendedVendors.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Suggested vendors for {pickedIssue.display_name}
                      </div>
                      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {recommendedVendors.map((v) => {
                          const picked = vendorId === v.id || (!vendorId && vendorName === v.name);
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                setVendorName(v.name);
                                setVendorId(v.id);
                              }}
                              className={cn(
                                "rounded-md border px-3 py-2 text-left text-xs transition",
                                picked
                                  ? "border-accent bg-accent/5 text-midnight"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:border-accent hover:bg-accent/5",
                              )}
                            >
                              <div className="font-medium text-midnight">{v.name}</div>
                              {v.category && (
                                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                                  {v.category}
                                </div>
                              )}
                              {v.phone && (
                                <div className="mt-0.5 text-[11px] text-zinc-600">{v.phone}</div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Search all store-visible vendors. */}
                  {!needsHelp && pickedStore && (
                    <div className="mt-2">
                      {!vendorSearchOpen ? (
                        <button
                          type="button"
                          onClick={() => setVendorSearchOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-accent hover:text-midnight"
                        >
                          <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
                          Search all vendors for this store…
                        </button>
                      ) : (
                        <div className="rounded-md border border-zinc-200 bg-white p-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={vendorSearchQ}
                              onChange={(e) => setVendorSearchQ(e.target.value)}
                              placeholder="Search vendor name or category…"
                              autoFocus
                              className="h-8 flex-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => { setVendorSearchOpen(false); setVendorSearchQ(""); }}
                              className="rounded p-1 text-zinc-400 hover:bg-zinc-100"
                              aria-label="Close vendor search"
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          </div>
                          <div className="mt-1 max-h-56 overflow-y-auto">
                            {loadingVendors && (
                              <div className="px-1 py-2 text-[11px] text-zinc-500">Loading vendors…</div>
                            )}
                            {!loadingVendors && vendorSearchResults.length === 0 && (
                              <div className="px-1 py-2 text-[11px] text-zinc-500">
                                No vendors match — type the name above to enter it manually.
                              </div>
                            )}
                            <ul className="divide-y divide-zinc-100">
                              {vendorSearchResults.map((v) => (
                                <li key={v.id}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVendorName(v.name);
                                      setVendorId(v.id);
                                      setVendorSearchOpen(false);
                                      setVendorSearchQ("");
                                    }}
                                    className="block w-full px-1 py-2 text-left text-xs hover:bg-zinc-50"
                                  >
                                    <span className="font-medium text-midnight">{v.name}</span>
                                    {v.category && <span className="text-zinc-500"> · {v.category}</span>}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Need help — flag for the DO. */}
                  <label className="mt-2 flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
                    <input
                      type="checkbox"
                      checked={needsHelp}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setNeedsHelp(on);
                        if (on) {
                          setVendorName("");
                          setVendorId("");
                          setVendorSearchOpen(false);
                        }
                      }}
                      className="h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
                    />
                    <span>
                      <span className="font-semibold text-midnight">Need help finding a vendor?</span>{" "}
                      We'll submit this ticket and flag it for your DO to assign one.
                    </span>
                  </label>
                </div>

                <div>
                  <Label>
                    Did you try basic troubleshooting? <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex gap-2">
                    {(["yes", "no"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setTroubleshooting(troubleshooting === v ? "" : v)}
                        className={cn(
                          "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                          troubleshooting === v
                            ? "border-accent bg-accent/10 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                        )}
                      >
                        {v === "yes" ? "Yes" : "No / not sure"}
                      </button>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold tracking-tight text-midnight">
                    Photos <span className="text-red-500">*</span> (at least 1, up to {MAX_PHOTOS})
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {photos.length} / {MAX_PHOTOS} · 5 MB each
                  </div>
                </div>

                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((p) => (
                      <div
                        key={p.id}
                        className="relative aspect-square overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                      >
                        <img src={p.previewUrl} alt={p.file.name} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(p.id)}
                          className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-red-600 shadow hover:bg-white"
                          title="Remove photo"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addPhotos(e.target.files);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={photos.length >= MAX_PHOTOS}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-3 py-3 text-sm font-medium transition",
                      photos.length >= MAX_PHOTOS
                        ? "border-zinc-200 text-zinc-400"
                        : "border-zinc-300 text-zinc-600 hover:border-accent hover:text-midnight",
                    )}
                  >
                    <ImagePlus className="h-4 w-4" strokeWidth={1.75} />
                    {photos.length >= MAX_PHOTOS ? "Photo limit reached" : "Add photos"}
                  </button>
                </div>
              </CardBody>
            </Card>

            {submitError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-zinc-500">
                By submitting, you confirm the info above is accurate. The store will be notified.
              </div>
              <Button variant="primary" onClick={submit} disabled={!canSubmit}>
                {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {submitButtonLabel}
              </Button>
            </div>
          </>
        )}

        <div className="pt-2 text-center text-[10px] uppercase tracking-wide text-zinc-400">
          Powered by SOAR Operations Hub
        </div>
      </main>
    </div>
  );
}
