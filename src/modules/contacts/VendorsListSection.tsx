// Vendors section that lives inside the /contacts page. Read-only — pulls
// from /.netlify/functions/facilities-v2?action=getVendors so the source
// of truth stays in the Facilities V2 Vendors tab. Tells admins where to
// go to edit.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail, Phone, Search, Star, X } from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthProvider";

interface FacilitiesV2Vendor {
  id: string;
  name: string;
  category: string | null;
  service_area: string | null;
  services: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  contact_person: string | null;
  notes: string | null;
  avgRating: number | null;
  totalRatings: number;
}

async function fetchVendors(): Promise<FacilitiesV2Vendor[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch("/.netlify/functions/facilities-v2?action=getVendors", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.message || `Vendors fetch ${res.status}`);
  }
  return body.vendors as FacilitiesV2Vendor[];
}

export function VendorsListSection() {
  const { profile } = useAuth();
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");

  const isAdmin = profile?.role === "admin";

  const vendorsQ = useQuery({
    queryKey: ["contacts-vendors-v2"],
    queryFn: fetchVendors,
    staleTime: 60_000,
  });

  const vendors = vendorsQ.data ?? [];

  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const v of vendors) {
      if (v.service_area) {
        // Some rows pack two areas with a comma; split + dedupe so the
        // filter pill renders one option per atomic area.
        v.service_area.split(",").map((s) => s.trim()).filter(Boolean)
          .forEach((a) => set.add(a));
      }
    }
    return Array.from(set).sort();
  }, [vendors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (area && !(v.service_area || "").includes(area)) return false;
      if (!q) return true;
      return [
        v.name, v.category, v.service_area, v.services,
        v.phone, v.email, v.contact_person, v.notes,
      ].filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [vendors, search, area]);

  return (
    <>
      <Card className="mb-4">
        <div className="space-y-3 p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              strokeWidth={1.75}
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendors, services, contact…"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-midnight"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <AreaPill active={area === ""} onClick={() => setArea("")} label="All Areas" />
            {areas.map((a) => (
              <AreaPill key={a} active={area === a} onClick={() => setArea(a)} label={a} />
            ))}
            {isAdmin && (
              <span className="ml-auto text-xs text-zinc-500">
                Read-only here — manage at{" "}
                <a
                  href="/admin/work-orders-v2"
                  className="font-medium text-accent hover:underline"
                >
                  /admin/work-orders-v2
                </a>
              </span>
            )}
          </div>
        </div>
      </Card>

      {vendorsQ.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {vendorsQ.isError && (
        <EmptyState
          title="Couldn't load vendors"
          description={(vendorsQ.error as Error)?.message ?? "Try again."}
        />
      )}
      {!vendorsQ.isLoading && filtered.length === 0 && (
        <EmptyState
          title={search || area ? "No matches" : "No vendors yet"}
          description={
            search || area
              ? "Adjust the filters or clear the search."
              : isAdmin
                ? "Add the first vendor at /admin/work-orders-v2."
                : "Your admin hasn't added vendors yet."
          }
        />
      )}

      {filtered.length > 0 && (
        <Card>
          <ul className="divide-y divide-zinc-100">
            {filtered.map((v) => <VendorRow key={v.id} v={v} />)}
          </ul>
        </Card>
      )}
    </>
  );
}

function AreaPill({
  active, onClick, label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium transition " +
        (active
          ? "bg-midnight text-white"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 hover:text-midnight")
      }
    >
      {label}
    </button>
  );
}

function VendorRow({ v }: { v: FacilitiesV2Vendor }) {
  const services = (v.services || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <li>
      <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold uppercase text-accent">
          {v.name.trim().slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-midnight">{v.name}</span>
            {v.category && <Badge tone="info">{v.category}</Badge>}
            {v.avgRating !== null && (
              <span className="inline-flex items-center gap-0.5 text-xs">
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" strokeWidth={1.75} />
                <span className="font-medium text-zinc-700">
                  {v.avgRating.toFixed(1)}
                </span>
                <span className="text-zinc-400">({v.totalRatings})</span>
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
            {v.service_area && <span>📍 {v.service_area}</span>}
            {v.contact_person && <span>👤 {v.contact_person}</span>}
          </div>
          {services.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {services.map((s) => (
                <span
                  key={s}
                  className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-600"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
          {v.notes && (
            <div className="mt-1 text-xs text-amber-700">📌 {v.notes}</div>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          {v.phone && (
            <a
              href={`tel:${v.phone.replace(/\D/g, "")}`}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <Phone className="h-3 w-3" strokeWidth={1.75} />
              {v.phone}
            </a>
          )}
          {v.email && (
            <a
              href={`mailto:${v.email}`}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              <Mail className="h-3 w-3" strokeWidth={1.75} />
              Email
            </a>
          )}
          {v.website && (
            <a
              href={v.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:border-accent hover:text-midnight"
            >
              <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
              Web
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
