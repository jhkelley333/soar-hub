// New Ticket modal. Opens from the Work Orders V2 page header. Loads
// the issue library lazily for the typeahead and lets the admin
// optionally attach photos that get uploaded immediately after the
// ticket row is created.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Loader2, Plus, Search, Upload, X } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useIsDesktop } from "@/lib/useMediaQuery";
import {
  createTicket,
  fetchCallerStores,
  fetchIssueLibrary,
  fetchRelatedInWarranty,
  fetchVendors,
  fileToBase64,
  searchVendors,
  uploadPhoto,
  type RelatedInWarrantyTicket,
} from "./api";
import {
  TICKET_PRIORITIES,
  type CallerStore,
  type CreateTicketBody,
  type IssueLibraryItem,
  type LineItem,
  type TicketPriority,
  type Vendor,
} from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (woNumber: string) => void;
  onError: (msg: string) => void;
}

const MAX_PHOTOS = 5;

// Form-side cost row (strings while editing). Converted to LineItem on
// submit; rows missing a label or a parseable amount are dropped.
interface LineRow {
  label: string;
  qty: string;
  amount: string;
}

function rowsToLineItems(rows: LineRow[]): LineItem[] {
  const out: LineItem[] = [];
  for (const r of rows) {
    const label = r.label.trim();
    const amount = parseFloat(r.amount);
    if (!label || !Number.isFinite(amount)) continue;
    const qty = parseInt(r.qty, 10);
    out.push({
      label,
      qty: Number.isFinite(qty) && qty >= 1 ? qty : 1,
      amount_cents: Math.round(amount * 100),
    });
  }
  return out;
}

function lineRowsTotal(rows: LineRow[]): number {
  return rows.reduce((sum, r) => {
    const a = parseFloat(r.amount);
    return sum + (Number.isFinite(a) ? a : 0);
  }, 0);
}

export function NewTicketModal({ open, onClose, onCreated, onError }: Props) {
  const isDesktop = useIsDesktop();

  const issueLibrary = useQuery({
    queryKey: ["wo2", "issueLibrary"],
    queryFn: fetchIssueLibrary,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Stores the caller has access to. Drives whether the Store field is
  // auto-filled (GM / shift-manager → single primary store) or a
  // dropdown (DO+ → pick from scoped stores).
  const callerStores = useQuery({
    queryKey: ["wo2", "callerStores"],
    queryFn: fetchCallerStores,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Form state.
  const [storeNumber, setStoreNumber] = useState("");
  const [issueText, setIssueText] = useState("");
  const [category, setCategory] = useState("");
  const [assetType, setAssetType] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("Standard");
  const [businessCritical, setBusinessCritical] = useState(false);
  const [vendorName, setVendorName] = useState("");
  // "Need help finding a vendor" — submits the ticket flagged for the DO
  // instead of requiring the store to pick a vendor.
  const [needsVendorHelp, setNeedsVendorHelp] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Optional cost breakdown. Inputs stay as strings; converted to the
  // LineItem shape (amount_cents) on submit. Backend derives the total.
  const [lineRows, setLineRows] = useState<LineRow[]>([]);
  // Troubleshooting gate — required answer before submit. Tips come from
  // the picked issue_library row (or the category fallback map below).
  const [troubleshooted, setTroubleshooted] = useState<"" | "yes" | "no">("");
  const [pickedTips, setPickedTips] = useState<string | null>(null);

  // Tracked separately from `issueText` so picking a suggestion closes
  // the dropdown even though the input value still matches.
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownCloseTimer = useRef<number | null>(null);

  // The asset_type used to fetch vendor recommendations. Set when the
  // user picks an issue from the typeahead, cleared when they edit the
  // text again.
  const [vendorPickAsset, setVendorPickAsset] = useState("");

  // Reset on open/close so a re-open starts clean.
  useEffect(() => {
    if (!open) return;
    setStoreNumber("");
    setIssueText("");
    setCategory("");
    setAssetType("");
    setModelNumber("");
    setDescription("");
    setPriority("Standard");
    setBusinessCritical(false);
    setVendorName("");
    setNeedsVendorHelp(false);
    setFiles([]);
    setLineRows([]);
    setDropdownOpen(false);
    setVendorPickAsset("");
    setTroubleshooted("");
    setPickedTips(null);
  }, [open]);

  // For single-store callers (GM / shift_manager) auto-fill the store
  // number once the caller-stores response arrives.
  useEffect(() => {
    if (!open) return;
    const data = callerStores.data;
    if (!data) return;
    if (data.mode === "single" && data.stores[0]) {
      setStoreNumber(data.stores[0].number);
    }
  }, [open, callerStores.data]);

  // Filter issue library by current typeahead text.
  const suggestions = useMemo(() => {
    const items = issueLibrary.data?.items ?? [];
    const q = issueText.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) =>
        i.display_name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        i.asset_type.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [issueText, issueLibrary.data]);

  function pickIssue(item: IssueLibraryItem) {
    setIssueText(item.display_name);
    setCategory(item.category);
    setAssetType(item.display_name);
    setDropdownOpen(false);
    setVendorPickAsset(item.display_name);
    setPickedTips(
      item.troubleshooting_tips?.trim()
        || fallbackTipsFor(item.category, item.asset_type, item.display_name)
        || null,
    );
    setTroubleshooted(""); // re-prompt the gate when issue changes
    // Cancel any pending blur-close so the click doesn't fight us.
    if (dropdownCloseTimer.current) {
      window.clearTimeout(dropdownCloseTimer.current);
      dropdownCloseTimer.current = null;
    }
  }

  function handleIssueTextChange(value: string) {
    setIssueText(value);
    setAssetType(value);
    setDropdownOpen(true);
    // Clear vendor recommendations if the user resumed editing — they're
    // no longer for a confirmed asset type.
    if (vendorPickAsset && value !== vendorPickAsset) setVendorPickAsset("");
    // Reset tips + gate so a fresh pick is required.
    setPickedTips(null);
    setTroubleshooted("");
  }

  // Vendor recommendations fire only after the user picks an issue, so
  // we always have a concrete asset_type to filter by. Limit to 3.
  // Pass the chosen store_number so the search filters out vendors
  // not visible at this store (vendor_scopes), AND pass the issue's
  // category so unit-specific asset types ("HVAC 1", "Fryer 2")
  // still match the high-level vendor categories ("HVAC", "Fryer").
  // Vendors with no scope rows still show — legacy "national"
  // fallback.
  const vendorRecs = useQuery({
    queryKey: ["wo2", "vendorRecs", vendorPickAsset, storeNumber.trim(), category],
    queryFn: () => searchVendors(
      "",
      vendorPickAsset,
      storeNumber.trim() || undefined,
      category || undefined,
    ),
    enabled: open && !!vendorPickAsset,
    staleTime: 60_000,
  });
  const recommendedVendors: Vendor[] = useMemo(() => {
    return (vendorRecs.data?.vendors ?? []).slice(0, 3);
  }, [vendorRecs.data]);

  // Warranty hint — does this store already have a recently-
  // completed ticket for the same asset/category that's still
  // under warranty? If so, surface it as a heads-up so the GM can
  // decide whether this is a callback rather than a fresh dispatch.
  const warrantyHintQ = useQuery({
    queryKey: ["wo2", "warrantyHint", storeNumber.trim(), vendorPickAsset, category],
    queryFn: () => fetchRelatedInWarranty(storeNumber.trim(), vendorPickAsset, category),
    enabled: open && !!storeNumber.trim() && (!!vendorPickAsset || !!category),
    staleTime: 60_000,
  });
  const [dismissedHints, setDismissedHints] = useState<Set<string>>(new Set());
  const warrantyHints: RelatedInWarrantyTicket[] = useMemo(() => {
    const all = warrantyHintQ.data?.tickets ?? [];
    return all.filter((t) => !dismissedHints.has(t.id));
  }, [warrantyHintQ.data, dismissedHints]);

  // Full visible-to-this-store vendor list, for the "Search all
  // vendors" expandable picker. Lazy — only fetched when the user
  // opens the picker (`vendorSearchOpen`).
  const [vendorSearchOpen, setVendorSearchOpen] = useState(false);
  const [vendorSearchQ, setVendorSearchQ] = useState("");
  const allVendorsQ = useQuery({
    queryKey: ["wo2", "vendorsForStore", storeNumber.trim()],
    queryFn: () => fetchVendors({ storeNumber: storeNumber.trim() || undefined }),
    enabled: open && vendorSearchOpen,
    staleTime: 60_000,
  });
  const filteredVendorSearch: Vendor[] = useMemo(() => {
    const list = allVendorsQ.data?.vendors ?? [];
    const recIds = new Set(recommendedVendors.map((r) => r.id));
    const q = vendorSearchQ.trim().toLowerCase();
    // Always exclude already-recommended vendors so the picker
    // never shows the same chip twice. When no query is typed,
    // surface the first 20 of the visible list so the user sees
    // something immediately on open instead of an empty box.
    const base = list.filter((v) => !recIds.has(v.id));
    if (!q) return base.slice(0, 20);
    return base
      .filter((v) =>
        [v.name, v.category, v.services, v.service_area, v.phone, v.email, v.contact_person]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [allVendorsQ.data, vendorSearchQ, recommendedVendors]);
  const totalVisibleVendors = (allVendorsQ.data?.vendors ?? []).length;

  function handleFiles(input: HTMLInputElement) {
    const arr = Array.from(input.files ?? []).slice(0, MAX_PHOTOS);
    setFiles(arr);
  }

  const submit = useMutation({
    mutationFn: async () => {
      if (!storeNumber.trim()) throw new Error("Store number is required.");
      if (!description.trim()) throw new Error("Issue description is required.");
      if (troubleshooted === "") {
        throw new Error('Answer "Did you troubleshoot?" before submitting.');
      }
      if (!needsVendorHelp && !vendorName.trim()) {
        throw new Error('Choose a vendor, or check "Need help finding a vendor".');
      }
      const lineItems = rowsToLineItems(lineRows);
      const body: CreateTicketBody = {
        storeNumber: storeNumber.trim(),
        category: category || undefined,
        assetType: assetType || issueText || undefined,
        modelNumber: modelNumber || undefined,
        issueDescription: description.trim(),
        priority,
        isBusinessCritical: businessCritical,
        vendorContacted: !needsVendorHelp && !!vendorName.trim(),
        vendorName: needsVendorHelp ? undefined : vendorName || undefined,
        needsVendorHelp: needsVendorHelp || undefined,
        troubleshootingChecked: troubleshooted === "yes",
        lineItems: lineItems.length ? lineItems : undefined,
      };
      const created = await createTicket(body);
      // Upload any attached photos sequentially so failures are obvious.
      for (const f of files) {
        const photoData = await fileToBase64(f);
        await uploadPhoto({
          id: created.ticket.id,
          photoData,
          photoType: f.type || "image/jpeg",
          photoName: f.name,
          uploadType: "submission",
        });
      }
      return created;
    },
    onSuccess: (data) => {
      onCreated(data.woNumber);
    },
    onError: (e: unknown) => {
      onError(e instanceof Error ? e.message : "Failed to create ticket.");
    },
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (dropdownOpen) setDropdownOpen(false);
          else onClose();
        }
      }}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl sm:rounded-xl"
        style={{
          // Cap the sheet so its top stays below the status bar / notch.
          // It's anchored to the bottom (items-end), so a too-tall sheet
          // would push its sticky header up behind the safe-area inset.
          // env() can't live in a responsive Tailwind class, so we branch
          // on viewport here. Desktop is centered and unaffected by insets.
          maxHeight: isDesktop
            ? "92vh"
            : "calc(100dvh - env(safe-area-inset-top, 0px) - 1rem)",
        }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-3">
          <div className="text-base font-semibold tracking-tight text-midnight">
            New Service Request
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="nt-store">Store *</Label>
              <StoreField
                id="nt-store"
                value={storeNumber}
                onChange={setStoreNumber}
                loading={callerStores.isLoading}
                error={callerStores.error}
                data={callerStores.data}
              />
            </div>
            <div>
              <Label htmlFor="nt-priority">Priority</Label>
              <select
                id="nt-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {TICKET_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div className="relative">
            <Label htmlFor="nt-issue">Issue / Asset Type *</Label>
            <Input
              id="nt-issue"
              value={issueText}
              onChange={(e) => handleIssueTextChange(e.target.value)}
              onFocus={() => {
                if (issueText.trim().length > 0) setDropdownOpen(true);
              }}
              onBlur={() => {
                // Delay so a click on a suggestion can register before
                // the blur closes the dropdown.
                dropdownCloseTimer.current = window.setTimeout(() => {
                  setDropdownOpen(false);
                  dropdownCloseTimer.current = null;
                }, 150);
              }}
              placeholder="Start typing — e.g. fryer, roof, HVAC…"
              autoComplete="off"
            />
            {dropdownOpen && suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-md">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      // onMouseDown fires before the input's blur, so
                      // pickIssue runs even if the input loses focus
                      // before the click handler would have run.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickIssue(s)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                        {s.category} · {s.asset_type}
                      </div>
                      <div className="text-midnight">{s.display_name}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {category && (
              <div className="mt-1 text-[11px] text-zinc-500">
                Selected: <span className="font-medium text-zinc-700">{category}</span> · {assetType}
              </div>
            )}
          </div>

          {pickedTips && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                Things to check first
              </div>
              <ul className="space-y-0.5">
                {pickedTips
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((line, i) => (
                    <li key={i} className="whitespace-pre-wrap leading-snug">
                      {line}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div>
            <Label>Did you troubleshoot? *</Label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setTroubleshooted("yes")}
                className={
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition " +
                  (troubleshooted === "yes"
                    ? "border-green-500 bg-green-50 text-green-900"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-accent")
                }
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setTroubleshooted("no")}
                className={
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition " +
                  (troubleshooted === "no"
                    ? "border-amber-500 bg-amber-50 text-amber-900"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-accent")
                }
              >
                No
              </button>
            </div>
            {troubleshooted === "no" && (
              <div className="mt-1 text-[11px] text-amber-700">
                Please try the steps above before submitting — most issues clear without a vendor visit.
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="nt-model">Model Number</Label>
            <Input
              id="nt-model"
              value={modelNumber}
              onChange={(e) => setModelNumber(e.target.value)}
              placeholder="If known"
            />
          </div>

          <div>
            <Label htmlFor="nt-desc">Issue Description *</Label>
            <textarea
              id="nt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Describe the issue in detail…"
              className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {warrantyHints.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900">
                Heads up — possible warranty match{warrantyHints.length === 1 ? "" : "es"}
              </div>
              <div className="mt-1 text-xs text-emerald-900">
                A recently completed ticket at this store may still be under warranty.
                Should this be a callback to the same vendor instead?
              </div>
              <ul className="mt-2 space-y-2">
                {warrantyHints.map((h) => (
                  <li key={h.id} className="rounded-md border border-emerald-100 bg-white p-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono font-semibold text-midnight">{h.wo_number}</span>
                      <span className="text-zinc-700">{h.asset_type || h.category}</span>
                      {h.vendor_name && (
                        <span className="text-zinc-500">· {h.vendor_name}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-emerald-900">
                      {h.labor_active && h.labor_expires_at && (
                        <span className="mr-2">
                          Labor warranty active through {fmtShortDate(h.labor_expires_at)}
                        </span>
                      )}
                      {h.parts_active && h.parts_expires_at && (
                        <span>
                          Parts warranty active through {fmtShortDate(h.parts_expires_at)}
                          {h.warranty_parts_source === "manufacturer" && " (mfg)"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {h.vendor_name && (
                        <button
                          type="button"
                          onClick={() => {
                            setVendorName(h.vendor_name || "");
                            setDescription((d) => {
                              const tag = `[Callback for ${h.wo_number}]`;
                              if (d.includes(tag)) return d;
                              return d.trim() ? `${tag} ${d}` : tag;
                            });
                            setDismissedHints((prev) => new Set(prev).add(h.id));
                          }}
                          className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-50"
                        >
                          Use as callback — assign {h.vendor_name}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDismissedHints((prev) => new Set(prev).add(h.id))}
                        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
                      >
                        Different issue, continue
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <Label htmlFor="nt-vendor">
              Vendor Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="nt-vendor"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder={needsVendorHelp ? "Your DO will assign a vendor" : "Search or select a vendor"}
              disabled={needsVendorHelp}
            />
            {!needsVendorHelp && vendorPickAsset && recommendedVendors.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Suggested vendors for {vendorPickAsset}
                </div>
                <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {recommendedVendors.map((v) => {
                    const picked = vendorName === v.name;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVendorName(v.name)}
                        className={
                          "rounded-md border px-3 py-2 text-left text-xs transition " +
                          (picked
                            ? "border-accent bg-accent/5 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-700 hover:border-accent hover:bg-accent/5")
                        }
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

            {/* "Search all vendors" expandable picker — searches the
                full vendor list visible to this store (scope-filtered)
                so a GM can find a vendor the recs missed without
                leaving the form. */}
            {!needsVendorHelp && (
            <div className="mt-2">
              {!vendorSearchOpen ? (
                <button
                  type="button"
                  onClick={() => setVendorSearchOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-accent hover:text-midnight"
                >
                  <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Search all vendors{storeNumber.trim() ? " for this store" : ""}…
                </button>
              ) : (
                <div className="rounded-md border border-zinc-200 bg-white p-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={vendorSearchQ}
                      onChange={(e) => setVendorSearchQ(e.target.value)}
                      placeholder="Search vendor name, category, service…"
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
                  {!allVendorsQ.isLoading && !allVendorsQ.isError && (
                    <div className="mt-1.5 px-1 text-[10px] text-zinc-500">
                      {totalVisibleVendors === 0
                        ? "No vendors visible"
                        : vendorSearchQ.trim()
                          ? `${filteredVendorSearch.length} of ${totalVisibleVendors} match`
                          : `${totalVisibleVendors} vendor${totalVisibleVendors === 1 ? "" : "s"} ${storeNumber.trim() ? `at store ${storeNumber.trim()}` : "active"}`}
                    </div>
                  )}
                  <div className="mt-1 max-h-56 overflow-y-auto">
                    {allVendorsQ.isLoading && (
                      <div className="px-1 py-2 text-[11px] text-zinc-500">Loading vendors…</div>
                    )}
                    {allVendorsQ.isError && (
                      <div className="px-1 py-2 text-[11px] text-red-700">
                        {(allVendorsQ.error as Error)?.message ?? "Couldn't load vendors."}
                      </div>
                    )}
                    {!allVendorsQ.isLoading && !allVendorsQ.isError && filteredVendorSearch.length === 0 && (
                      <div className="px-1 py-2 text-[11px] text-zinc-500">
                        {totalVisibleVendors === 0
                          ? (storeNumber.trim()
                              ? `No vendors are scoped to store ${storeNumber.trim()}. Type the vendor name above to enter manually, or have an admin add a scope row.`
                              : "No vendors in the system yet.")
                          : vendorSearchQ.trim()
                            ? "No vendors match this search. Try a broader term, or type the vendor name above to enter manually."
                            : "All visible vendors are already in the recommended list above."}
                      </div>
                    )}
                    <ul className="divide-y divide-zinc-100">
                      {filteredVendorSearch.map((v) => {
                        const picked = vendorName === v.name;
                        return (
                          <li key={v.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setVendorName(v.name);
                                setVendorSearchOpen(false);
                                setVendorSearchQ("");
                              }}
                              className={
                                "block w-full px-2 py-1.5 text-left text-xs transition " +
                                (picked
                                  ? "bg-accent/10 text-midnight"
                                  : "text-zinc-700 hover:bg-zinc-50")
                              }
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-midnight">{v.name}</span>
                                {v.phone && (
                                  <span className="text-[10px] text-zinc-500">{v.phone}</span>
                                )}
                              </div>
                              {(v.category || v.service_area) && (
                                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                                  {[v.category, v.service_area].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Escape hatch: store doesn't know which vendor to use. Submits
                the ticket flagged for the DO to assign one. */}
            <label className="mt-3 flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
              <input
                type="checkbox"
                checked={needsVendorHelp}
                onChange={(e) => setNeedsVendorHelp(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-accent focus:ring-accent"
              />
              <span>
                <span className="font-medium text-midnight">Need help finding a vendor?</span>{" "}
                We'll submit this ticket and flag it for your DO to assign one.
              </span>
            </label>
          </div>

          {/* Cost breakdown — optional. When any complete rows are
              present the backend sets the total as cost_estimate. */}
          <div>
            <Label>Cost Breakdown</Label>
            <p className="-mt-0.5 mb-2 text-[11px] text-zinc-500">
              Optional. Add line items and we'll total them for the approval request.
            </p>
            {lineRows.length > 0 && (
              <div className="space-y-2">
                {lineRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1">
                      <Input
                        value={row.label}
                        onChange={(e) =>
                          setLineRows((rs) =>
                            rs.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)),
                          )
                        }
                        placeholder="e.g. Replacement unit"
                      />
                    </div>
                    <div className="w-14">
                      <Input
                        value={row.qty}
                        onChange={(e) =>
                          setLineRows((rs) =>
                            rs.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)),
                          )
                        }
                        inputMode="numeric"
                        placeholder="Qty"
                        className="text-center"
                      />
                    </div>
                    <div className="relative w-28">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                        $
                      </span>
                      <Input
                        value={row.amount}
                        onChange={(e) =>
                          setLineRows((rs) =>
                            rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)),
                          )
                        }
                        inputMode="decimal"
                        placeholder="0"
                        className="pl-5"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setLineRows((rs) => rs.filter((_, j) => j !== i))}
                      className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
                      aria-label="Remove line item"
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setLineRows((rs) => [...rs, { label: "", qty: "1", amount: "" }])
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-accent hover:text-midnight"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Add line item
              </button>
              {lineRows.length > 0 && (
                <div className="text-sm font-semibold text-midnight">
                  Total: ${lineRowsTotal(lineRows).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-midnight">
            <input
              type="checkbox"
              checked={businessCritical}
              onChange={(e) => setBusinessCritical(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Business Critical
          </label>

          <div>
            <Label htmlFor="nt-photos">Photos (up to {MAX_PHOTOS})</Label>
            <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <Camera className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <div>
                <span className="font-semibold">One photo must show the equipment serial number.</span>{" "}
                Vendors need it to look up parts and warranty info.
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-zinc-200 bg-white py-3 text-sm text-zinc-600 transition hover:border-accent hover:bg-accent/5 hover:text-midnight"
            >
              <Upload className="h-4 w-4" strokeWidth={1.75} />
              {files.length === 0
                ? "Tap to add photos"
                : `${files.length} file${files.length === 1 ? "" : "s"} selected`}
            </button>
            <input
              ref={fileInputRef}
              id="nt-photos"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target)}
            />
            {files.length > 0 && (
              <div className="mt-2 text-[11px] text-zinc-500">
                {files.map((f) => f.name).join(", ")}
              </div>
            )}
          </div>
        </div>

        <div
          className="sticky bottom-0 z-10 flex flex-col-reverse items-stretch gap-2 border-t border-zinc-100 bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-end"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => submit.mutate()}
            disabled={submit.isPending || troubleshooted === ""}
            title={troubleshooted === "" ? "Answer the troubleshooting question first." : undefined}
          >
            {submit.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {submit.isPending ? "Submitting…" : "Submit Request"}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface StoreFieldProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  loading: boolean;
  error: unknown;
  data: { mode: "single" | "list"; stores: CallerStore[] } | undefined;
}

// Renders one of three states:
//   loading                  → disabled placeholder
//   error / no stores        → falls back to a free-text input
//   single (GM, shift mgr)   → read-only auto-filled chip
//   list (DO+)               → <select> of stores in scope
function StoreField({ id, value, onChange, loading, error, data }: StoreFieldProps) {
  if (loading) {
    return (
      <Input
        id={id}
        value=""
        onChange={() => undefined}
        placeholder="Loading…"
        disabled
      />
    );
  }

  // If the lookup failed or returned nothing, fall back to manual entry
  // so the user can still submit (e.g. admins / first-run accounts).
  if (error || !data || data.stores.length === 0) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 1082"
      />
    );
  }

  if (data.mode === "single") {
    const store = data.stores[0];
    return (
      <div
        id={id}
        className="flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-midnight"
      >
        <span className="font-medium">{store.number}</span>
        {store.name && <span className="ml-2 text-zinc-500">— {store.name}</span>}
      </div>
    );
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-midnight focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    >
      <option value="">Select a store…</option>
      {data.stores.map((s) => (
        <option key={s.id} value={s.number}>
          {s.number}{s.name ? ` — ${s.name}` : ""}
        </option>
      ))}
    </select>
  );
}

// Heuristic fallback when an issue_library row has no curated tips.
// Picks a list based on category/asset_type keywords so the user still
// gets a "things to check first" prompt for un-customized items. Admins
// can override by editing the issue_library row's troubleshooting_tips.
function fallbackTipsFor(category: string, assetType: string, displayName: string): string | null {
  const hay = `${category} ${assetType} ${displayName}`.toLowerCase();
  if (/fryer/.test(hay)) {
    return [
      "• Check the breaker — flip fully off, then back on.",
      "• Confirm oil level is between the min/max lines.",
      "• Verify thermostat dial is set correctly.",
      "• Listen for burners igniting — if silent, gas valve may be off.",
    ].join("\n");
  }
  if (/hvac|ac\b|heat|furnace|rtu/.test(hay)) {
    return [
      "• Replace or clean the air filter.",
      "• Check thermostat batteries and mode (Cool / Heat).",
      "• Inspect the breaker.",
      "• Confirm the outdoor unit isn't iced over or blocked.",
    ].join("\n");
  }
  if (/ice/.test(hay) && /(machine|maker)/.test(hay)) {
    return [
      "• Verify water supply valve is fully open.",
      "• Check the water filter — swap if older than 6 months.",
      "• Look at the breaker.",
      "• Confirm bin door closes flush so the bin-full sensor isn't tripped.",
    ].join("\n");
  }
  if (/refrig|cooler|freezer|walk-in|reach-in/.test(hay)) {
    return [
      "• Check the breaker.",
      "• Verify thermostat setpoint hasn't been changed.",
      "• Look for blocked vents (over-packed boxes) or dirty condenser coils.",
      "• Confirm the door gasket seals flush.",
    ].join("\n");
  }
  if (/pos|register|kiosk|tablet|drawer/.test(hay)) {
    return [
      "• Power cycle — fully off for 30 seconds, then back on.",
      "• Confirm network cables are seated; test internet on another device.",
      "• Check for an error banner/toast on the device.",
      "• Note the exact error message.",
    ].join("\n");
  }
  if (/frozen drink|slush|bib|co2|beverage/.test(hay)) {
    return [
      "• Check the breaker.",
      "• Verify CO2 / syrup BIB is not empty.",
      "• Inspect lines for kinks or disconnections.",
      "• Note any leaking around fittings.",
    ].join("\n");
  }
  if (/door|lock|hinge/.test(hay)) {
    return [
      "• Try the door multiple times to identify if the issue is intermittent.",
      "• Check for visible damage on hinges or strike plate.",
      "• Confirm the lock turns freely with the key.",
    ].join("\n");
  }
  if (/light|bulb|lamp|fixture/.test(hay)) {
    return [
      "• Try swapping the bulb with a known-good one.",
      "• Check the breaker.",
      "• Note if any other lights on the same circuit are out.",
    ].join("\n");
  }
  if (/plumb|leak|water|drain|sink|toilet/.test(hay)) {
    return [
      "• Locate the shutoff valve in case the leak worsens.",
      "• Note where the water is coming from (supply line vs drain).",
      "• Check for standing water or damage to nearby surfaces.",
    ].join("\n");
  }
  return null;
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
