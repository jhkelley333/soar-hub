// Store detail view — leadership chain (DO/SDO/RVP) at the top, then a
// team members card listing GMs / Shift Managers assigned to this
// store. Each row in the team list opens the MemberProfileDrawer.

import { Mail, MapPin, Phone } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import type {
  LeadershipPerson,
  MyStoreNode,
  MyStoreTeamMember,
  StoreLeadership,
} from "./types";

function formatBirthdayShort(iso: string | null): string | null {
  if (!iso) return null;
  // Expect YYYY-MM-DD; render as "Mar 15" (no year).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [_, mm, dd] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(mm, 10);
  if (m < 1 || m > 12) return null;
  return `${months[m - 1]} ${parseInt(dd, 10)}`;
}

export function StoreDetail({
  store,
  leadership,
  onMemberClick,
}: {
  store: MyStoreNode;
  leadership: StoreLeadership | null;
  onMemberClick: (m: MyStoreTeamMember) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-3xl font-semibold tracking-tight text-midnight tabular-nums">
                Store #{store.number}
              </div>
              {store.name && (
                <div className="mt-1 text-base text-zinc-700">{store.name}</div>
              )}
              {(store.city || store.state || store.address) && (
                <div className="mt-2 flex items-start gap-1.5 text-sm text-zinc-600">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />
                  <div>
                    {store.address && <div>{store.address}</div>}
                    {(store.city || store.state) && (
                      <div>{[store.city, store.state].filter(Boolean).join(", ")}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {!store.is_active && <Badge tone="neutral">Inactive</Badge>}
          </div>
        </CardBody>
      </Card>

      {/* Leadership card */}
      <Card>
        <CardHeader title="Leadership" description="The chain of command for this store." />
        <CardBody>
          {leadership ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LeadershipSlot label="Director of Operations" person={leadership.do} />
              <LeadershipSlot label="Sr. Director of Operations" person={leadership.sdo} />
              <LeadershipSlot label="Regional VP" person={leadership.rvp} />
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No leadership info available.</div>
          )}
        </CardBody>
      </Card>

      {/* Team Members card */}
      <Card>
        <CardHeader
          title="Team Members"
          description={`${store.team_members.length} assigned to this store.`}
        />
        {store.team_members.length === 0 ? (
          <CardBody>
            <div className="text-sm text-zinc-500">
              No team members assigned to this store yet.
            </div>
          </CardBody>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {store.team_members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onMemberClick(m)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-midnight">
                        {m.preferred_name || m.full_name || m.email}
                      </span>
                      <Badge tone="info">
                        {ROLE_LABELS[m.role as UserRole] ?? m.role}
                      </Badge>
                      {!m.is_active && <Badge tone="neutral">Inactive</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                      <span>{m.email}</span>
                      {m.phone && <span>{formatPhoneForDisplay(m.phone)}</span>}
                      {m.show_birthday !== false && m.birthday && formatBirthdayShort(m.birthday) && (
                        <span>🎂 {formatBirthdayShort(m.birthday)}</span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LeadershipSlot({
  label,
  person,
}: {
  label: string;
  person: LeadershipPerson | null;
}) {
  const toast = useToast();

  if (!person) {
    return (
      <div className="rounded-md border border-dashed border-zinc-200 px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          {label}
        </div>
        <div className="mt-1 text-sm text-zinc-400">Not assigned</div>
      </div>
    );
  }

  function copyEmail() {
    navigator.clipboard?.writeText(person!.email).then(
      () => toast.push("Email copied.", "success"),
      () => toast.push("Couldn't copy email.", "error")
    );
  }

  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-midnight">
        {person.preferred_name || person.full_name || person.email}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={copyEmail}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700 transition hover:bg-zinc-200 hover:text-midnight"
          title={person.email}
        >
          <Mail className="h-3 w-3" strokeWidth={1.75} />
          Copy email
        </button>
        {person.phone && (
          <a
            href={`tel:${person.phone}`}
            className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700 transition hover:bg-zinc-200 hover:text-midnight"
          >
            <Phone className="h-3 w-3" strokeWidth={1.75} />
            {formatPhoneForDisplay(person.phone)}
          </a>
        )}
      </div>
    </div>
  );
}
