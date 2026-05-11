// Make the Right Call drawer — escalation chain for HR / workplace
// concerns, sourced live from the org chart. Auto-populates from the
// signed-in user's primary store: GM (step 1), DO (step 2), SDO or RVP
// (step 3). Falls back to Sonic HR and the SOAR confidential hotline
// at the bottom for issues that need to bypass the local chain.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Mail, MapPin, MessageSquare, Phone, ShieldAlert } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Skeleton } from "@/shared/ui/Skeleton";
import { formatPhoneForDisplay } from "@/lib/phone";
import { ROLE_LABELS } from "@/types/database";
import type { EscalationContext, EscalationProfile } from "@/types/database";
import { fetchEscalationChain } from "./api";

export function MakeTheRightCallDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["escalation-chain"],
    queryFn: fetchEscalationChain,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  return (
    <Drawer open={open} onClose={onClose} title="Make the Right Call">
      <div className="space-y-5">
        {/* Framing message */}
        <div className="rounded-md border border-frost/40 bg-frost/10 px-3 py-2.5 text-sm text-midnight">
          Talk with your manager first if they have any questions, concerns,
          or suggestions regarding their position, responsibilities, or any
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
        {query.data && (
          <>
            {query.data.missing === "primary_store_id" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Your account isn't assigned to a store yet, so we can't show
                your manager chain. Ask your admin to set your primary store.
              </div>
            ) : (
              <ContextHeader context={query.data.context} />
            )}
            <div className="space-y-3">
              <Step
                n={1}
                title="Your General Manager"
                person={query.data.chain.gm}
                missingScopeLabel={
                  query.data.context.store_number
                    ? `Store #${query.data.context.store_number}`
                    : null
                }
              />
              <Step
                n={2}
                title="Director of Operations"
                person={query.data.chain.do}
                missingScopeLabel={
                  query.data.context.district_name ??
                  query.data.context.area_name ??
                  query.data.context.region_name ??
                  null
                }
              />
              <Step
                n={3}
                title="Senior Director or Regional VP"
                person={query.data.chain.sdo_or_rvp}
                missingScopeLabel={
                  query.data.context.area_name ??
                  query.data.context.region_name ??
                  null
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
  missingScopeLabel,
}: {
  n: number;
  title: string;
  person: EscalationProfile | null;
  missingScopeLabel: string | null;
}) {
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
          {person ? (
            <PersonCard person={person} />
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              {missingScopeLabel
                ? `No one with this role is assigned with scope over ${missingScopeLabel}. Ask your admin to add an assignment.`
                : "Your store isn't linked to this level of the org tree yet — contact your admin to set up the scope chain."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ContextHeader({ context }: { context: EscalationContext }) {
  const parts: string[] = [];
  if (context.store_number) {
    parts.push(`Store #${context.store_number}${context.store_name ? ` — ${context.store_name}` : ""}`);
  }
  if (context.district_name) parts.push(`District ${context.district_name}`);
  if (context.area_name)     parts.push(`Area ${context.area_name}`);
  if (context.region_name)   parts.push(`Region ${context.region_name}`);
  if (parts.length === 0) return null;
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

function PersonCard({ person }: { person: EscalationProfile }) {
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
            {ROLE_LABELS[person.role]}
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

