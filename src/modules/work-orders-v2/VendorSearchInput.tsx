// Reusable typeahead for picking a vendor (or typing a free-text
// vendor name) on existing tickets. Used by:
//   * The Update Ticket panel in WorkOrdersV2Page
//   * The "Schedule Vendor" modal in ReasonModal
//
// Behavior:
//   * Loads vendors visible at `storeNumber` via fetchVendors (same
//     scope filtering WO2 uses everywhere else)
//   * Client-side filters the list as the user types, on name,
//     category, services, service_area, phone, email, contact_person
//   * Picking a vendor sets BOTH the display name + the vendor id
//     (via onChange). Typing a name that doesn't match any vendor
//     keeps the typed string and clears the id — preserves today's
//     "type Joe's brother" free-text behavior for one-off vendors.
//   * Empty result set still shows the suggestions popover with a
//     "no matches — will be saved as free text" hint so the user
//     understands what's about to happen.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Input } from "@/shared/ui/Input";
import { fetchVendors } from "./api";
import type { Vendor } from "./types";

interface Props {
  id?: string;
  storeNumber: string | undefined;
  value: string;
  vendorId: string | null;
  onChange: (next: { name: string; id: string | null }) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function VendorSearchInput({
  id,
  storeNumber,
  value,
  vendorId,
  onChange,
  placeholder = "Search vendors…",
  disabled = false,
  autoFocus = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const vendorsQ = useQuery({
    queryKey: ["wo2", "vendorsForStore", storeNumber || ""],
    queryFn: () => fetchVendors({ storeNumber: storeNumber || undefined }),
    enabled: !disabled,
    staleTime: 60_000,
  });

  const matches: Vendor[] = useMemo(() => {
    const list = vendorsQ.data?.vendors ?? [];
    const q = value.trim().toLowerCase();
    if (!q) return list.slice(0, 20);
    return list
      .filter((v) =>
        [v.name, v.category, v.services, v.service_area, v.phone, v.email, v.contact_person]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [vendorsQ.data, value]);

  // Close the popover when the user clicks outside the wrapper.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const exactPick = useMemo(() => {
    if (!vendorId) return null;
    const list = vendorsQ.data?.vendors ?? [];
    return list.find((v) => v.id === vendorId) || null;
  }, [vendorId, vendorsQ.data]);

  // If the typed value diverges from the picked vendor's name, drop
  // the id so we don't link a stale vendor on save.
  const showingLinkedId = exactPick && exactPick.name === value;

  return (
    <div ref={wrapRef} className="relative">
      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
        <Search className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          // Any edit clears the linked id unless it still matches a
          // vendor name exactly — the popover row click below restores
          // it on a deliberate pick.
          onChange({ name: next, id: null });
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        className="pl-8"
      />
      {showingLinkedId && (
        <div className="mt-1 text-[10px] text-emerald-700">
          Linked to vendor: <span className="font-semibold">{exactPick!.name}</span>
        </div>
      )}
      {open && !disabled && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg">
          {vendorsQ.isLoading && (
            <div className="px-3 py-2 text-xs text-zinc-500">Loading vendors…</div>
          )}
          {!vendorsQ.isLoading && matches.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">
              {value.trim()
                ? <>No vendors match. Will be saved as free text: <span className="font-semibold">{value.trim()}</span></>
                : "No vendors visible at this store."}
            </div>
          )}
          {matches.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onChange({ name: v.name, id: v.id });
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
            >
              <div className="font-semibold text-midnight">{v.name}</div>
              <div className="text-[11px] text-zinc-500">
                {[v.category, v.service_area].filter(Boolean).join(" · ") || "—"}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
