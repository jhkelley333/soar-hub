// Make the Right Call drawer — escalation chain for HR / workplace
// concerns. Pulls from the SAME `my-tree` endpoint that powers the
// My Stores leadership card, so the data shown here is guaranteed to
// match what the user sees on My Stores. No separate lookup path.
//
// Falls back to Sonic HR and the SOAR confidential hotline at the
// bottom for issues that need to bypass the local chain.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Mail, MapPin, MessageSquare, Phone, ShieldAlert } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useAuth } from "@/auth/AuthProvider";
import { formatPhoneForDisplay } from "@/lib/phone";
import { ROLE_LABELS } from "@/types/database";
import type { UserRole } from "@/types/database";
import { fetchMyTree } from "@/modules/my-stores/api";
import type { LeadershipPerson, MyStoreNode } from "@/modules/my-stores/types";

export function MakeTheRightCallDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const query = useQuery({
    queryKey: ["my-stores-tree"],
    queryFn: fetchMyTree,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  // Locate the caller's store in the tree. Prefer primary_store_id;
  // fall back to "the only store in your visible tree" — this mirrors
  // MyStoresPage's auto-jump for GMs without primary_store_id populated,
  // so we never claim "not assigned" when the org chart clearly shows
  // exactly one store the user can see.
  const located = useMemo(() => {
    if (!query.data) return null;
    const all: {
      region: typeof query.data.regions[number];
      area: typeof query.data.regions[number]["areas"][number];
      district: typeof query.data.regions[number]["areas"][number]["districts"][number];
      store: MyStoreNode;
    }[] = [];
    for (const region of query.data.regions) {
      for (const area of region.areas) {
        for (const district of area.districts) {
          for (const store of district.stores) {
            all.push({ region, area, district, store });
          }
        }
      }
    }
    if (profile?.primary_store_id) {
      const hit = all.find((x) => x.store.id === profile.primary_store_id);
      if (hit) return hit;
    }
    if (all.length === 1) return all[0];
    return null;
  }, [profile?.primary_store_id, query.data]);

  // Multi-store users (DO/SDO/RVP/admin) shouldn't be using MTC anyway —
  // they ARE the escalation chain. Show a friendlier message instead of
  // "your account isn't assigned to a store" which is misleading for
  // those roles.
  const multiStoreCaller = !!query.data && !located && (
    query.data.regions.some((r) =>
      r.areas.some((a) =>
        a.districts.some((d) => d.stores.length > 0)
      )
    )
  );

  const leadership = located
    ? query.data?.leadership?.[located.store.id] ?? null
    : null;

  return (
    <Drawer open={open} onClose={onClose} title="Make the Right Call">
      <div className="space-y-5">
        {/* Framing message — second person */}
        <div className="rounded-md border border-frost/40 bg-frost/10 px-3 py-2.5 text-sm text-midnight">
          Talk with your manager first if you have any questions, concerns,
          or suggestions regarding your position, responsibilities, or any
          other workplace concerns.
        </div>

        {/* Escalation steps */}
        {query.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {query.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Couldn't load your escalation chain.{" "}
            {(query.error as Error)?.message}
          </div>
        )}
        {query.data && !located && multiStoreCaller && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            Make the Right Call is for store-level employees escalating
            up the chain. Your account oversees multiple stores, so you
            already sit in the chain — there's nothing above this to
            auto-route to.
          </div>
        )}
        {query.data && !located && !multiStoreCaller && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Your account isn't linked to any store in the org tree. Ask
            your admin to set your primary store or assign you to a
            store-level scope.
          </div>
        )}
        {located && (
          <>
            <ContextHeader store={located.store} district={located.district.name} area={located.area.name} region={located.region.name} />
            <div className="space-y-3">
              <Step
                n={1}
                title="Your General Manager"
                person={leadership?.gm ?? null}
                callerId={profile?.id ?? null}
                fallbackScope={`Store #${located.store.number}`}
              />
              <Step
                n={2}
                title="Director of Operations"
                person={leadership?.do ?? null}
                callerId={profile?.id ?? null}
                fallbackScope={
                  located.district.name ??
                  located.area.name ??
                  located.region.name
                }
              />
              <Step
                n={3}
                title="Senior Director or Regional VP"
                person={leadership?.sdo ?? leadership?.rvp ?? null}
                callerId={profile?.id ?? null}
                fallbackScope={
                  located.area.name ?? located.region.name
                }
              />
            </div>
          </>
        )}

        {/* When to use this — collapsible */}
        <WhenToUse />

        {/* Sonic HR fallback */}
        <FallbackBlock
          title="Sonic HR"
          phone="8666576642"
          phoneDisplay="(866) 657-6642"
          website="https://www.support.sonicdrivein.com/ContactUs/EmailUs"
          websiteLabel="support.sonicdrivein.com — Contact Us / Email Us"
          subtitle="Please allow 48 hours for response."
        />

        {/* Confidential Reporting Hotline */}
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <ShieldAlert className="h-4 w-4" strokeWidth={1.75} />
            Confidential Reporting Hotline
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-red-900 sm:grid-cols-2">
            <a
              href="tel:+14057786878"
              className="inline-flex items-center gap-1.5 rounded bg-white px-2 py-1 ring-1 ring-red-200 hover:bg-red-100"
            >
              <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
              405.778.6878 x315
            </a>
            <a
              href="mailto:HR@SOARQSR.com"
              className="inline-flex items-center gap-1.5 rounded bg-white px-2 py-1 ring-1 ring-red-200 hover:bg-red-100"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              HR@SOARQSR.com
            </a>
          </div>
          <p className="mt-2 text-xs text-red-800">
            All reports are kept strictly confidential. Retaliation against
            anyone who raises a concern in good faith is prohibited.
          </p>
        </div>
      </div>
    </Drawer>
  );
}

// ----------------------------------------------------------------------------
// Subcomponents
// ----------------------------------------------------------------------------

function Step({
  n,
  title,
  person,
  callerId,
  fallbackScope,
}: {
  n: number;
  title: string;
  person: LeadershipPerson | null;
  callerId: string | null;
  fallbackScope: string | null;
}) {
  const isSelf = !!person && !!callerId && person.id === callerId;
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-midnight text-xs font-semibold text-white">
          {n}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {title}
          </div>
          {person && isSelf && (
            <p className="mt-1 text-sm text-emerald-700">
              That&rsquo;s you — escalate to the next step if you need
              support beyond your own authority.
            </p>
          )}
          {person && !isSelf && <PersonCard person={person} />}
          {!person && (
            <p className="mt-1 text-sm text-zinc-500">
              {fallbackScope
                ? `No one with this role is assigned with scope over ${fallbackScope}. Ask your admin to add an assignment.`
                : "Your store isn't linked to this level of the org tree yet — contact your admin to set up the scope chain."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonCard({ person }: { person: LeadershipPerson }) {
  const name = person.preferred_name || person.full_name || person.email;
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        {person.profile_photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.profile_photo_url}
            alt=""
            className="h-7 w-7 rounded-full object-cover ring-1 ring-zinc-200"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold uppercase text-zinc-500">
            {(name ?? "?").trim().slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-midnight truncate">{name}</div>
          <div className="text-[11px] text-zinc-500">
            {ROLE_LABELS[person.role as UserRole] ?? person.role}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {person.phone && (
          <>
            <a
              href={`tel:${person.phone.replace(/[^0-9+]/g, "")}`}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200 hover:text-midnight"
            >
              <Phone className="h-3 w-3" strokeWidth={1.75} />
              Call {formatPhoneForDisplay(person.phone)}
            </a>
            <a
              href={`sms:${person.phone.replace(/[^0-9+]/g, "")}`}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200 hover:text-midnight"
            >
              <MessageSquare className="h-3 w-3" strokeWidth={1.75} />
              Text
            </a>
          </>
        )}
        {person.email && (
          <a
            href={`mailto:${person.email}`}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-200 hover:text-midnight"
          >
            <Mail className="h-3 w-3" strokeWidth={1.75} />
            Email
          </a>
        )}
      </div>
    </div>
  );
}

function ContextHeader({
  store,
  district,
  area,
  region,
}: {
  store: MyStoreNode;
  district: string | null;
  area: string | null;
  region: string | null;
}) {
  const parts: string[] = [];
  parts.push(`Store #${store.number}${store.name ? ` — ${store.name}` : ""}`);
  if (district) parts.push(`District ${district}`);
  if (area)     parts.push(`Area ${area}`);
  if (region)   parts.push(`Region ${region}`);
  return (
    <div className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />
      <div>
        <div className="font-semibold text-midnight">Your scope</div>
        <div className="mt-0.5 text-zinc-600">{parts.join(" → ")}</div>
      </div>
    </div>
  );
}

const ESCALATION_REASONS = [
  "HR policy clarification",
  "Work environment concerns",
  "Accommodations",
  "Social media concerns",
  "Corrective action appeals",
  "Performance management",
];

function WhenToUse() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-midnight hover:bg-zinc-50"
      >
        <span>When to use this escalation chain</span>
        <ChevronDown
          className={`h-4 w-4 text-zinc-400 transition ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <ul className="border-t border-zinc-100 px-5 py-2 text-sm text-zinc-700 list-disc">
          {ESCALATION_REASONS.map((r) => (
            <li key={r} className="py-0.5">{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FallbackBlock({
  title,
  phone,
  phoneDisplay,
  website,
  websiteLabel,
  subtitle,
}: {
  title: string;
  phone: string;
  phoneDisplay: string;
  website?: string;
  websiteLabel?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="text-sm font-semibold text-amber-900">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm text-amber-900">
        <a
          href={`tel:${phone}`}
          className="inline-flex items-center gap-1.5 rounded bg-white px-2 py-1 ring-1 ring-amber-200 hover:bg-amber-100"
        >
          <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
          {phoneDisplay}
        </a>
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded bg-white px-2 py-1 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
            {websiteLabel ?? website}
          </a>
        )}
      </div>
      {subtitle && <p className="mt-2 text-xs text-amber-800">{subtitle}</p>}
    </div>
  );
}
