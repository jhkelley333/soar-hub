// Slide-out drawer for a team member's profile. Reuses the shared
// Drawer + PAF detail components.
//
// PAF history section visible only to viewers with DO-or-above role
// per the spec (DO/SDO/RVP/VP/COO/Admin/Payroll). Two lists:
//   - PAFs the person submitted (`submitter_id = member.id`)
//   - PAFs that mention the person as employee (fuzzy ILIKE match on
//     employee_name) — soft match; labeled clearly so reviewers know
//     a name collision is possible.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, Phone } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import { listPafs } from "@/modules/paf/api";
import { PafTable } from "@/modules/paf/PafTable";
import type { MyStoreTeamMember } from "./types";

const PAF_VIEW_ROLES: UserRole[] = [
  "do", "sdo", "rvp", "vp", "coo", "admin", "payroll",
];

export function MemberProfileDrawer({
  open,
  member,
  viewerRole,
  onClose,
}: {
  open: boolean;
  member: MyStoreTeamMember | null;
  viewerRole: UserRole | undefined;
  onClose: () => void;
}) {
  const canSeePafHistory =
    viewerRole !== undefined && PAF_VIEW_ROLES.includes(viewerRole);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        member
          ? member.preferred_name || member.full_name || member.email
          : ""
      }
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {member && (
        <ProfileBody
          member={member}
          canSeePafHistory={canSeePafHistory}
        />
      )}
    </Drawer>
  );
}

function ProfileBody({
  member,
  canSeePafHistory,
}: {
  member: MyStoreTeamMember;
  canSeePafHistory: boolean;
}) {
  const toast = useToast();

  function copyEmail() {
    navigator.clipboard?.writeText(member.email).then(
      () => toast.push("Email copied.", "success"),
      () => toast.push("Couldn't copy email.", "error")
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <Section title="Contact">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">
              {ROLE_LABELS[member.role as UserRole] ?? member.role}
            </Badge>
            {!member.is_active && <Badge tone="neutral">Inactive</Badge>}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={copyEmail}
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-200 hover:text-midnight"
              title={member.email}
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              Copy email
            </button>
            {member.phone && (
              <a
                href={`tel:${member.phone}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-200 hover:text-midnight"
              >
                <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
                {formatPhoneForDisplay(member.phone)}
              </a>
            )}
          </div>
          <div className="pt-1 text-xs text-zinc-500">{member.email}</div>
          {member.show_birthday !== false && member.birthday && (
            <div className="text-xs text-zinc-500">
              🎂 Birthday: {formatBirthdayShort(member.birthday)}
            </div>
          )}
        </div>
      </Section>

      {canSeePafHistory && (
        <PafHistorySection
          memberId={member.id}
          memberName={member.full_name ?? ""}
          memberEmail={member.email}
        />
      )}
    </div>
  );
}

function PafHistorySection({
  memberId,
  memberName,
  memberEmail,
}: {
  memberId: string;
  memberName: string;
  memberEmail: string;
}) {
  const [tab, setTab] = useState<"submitted" | "mentioned">("submitted");

  // Reuse the existing /paf?action=list response — already scoped by
  // the caller's reach. We filter client-side by the member.
  const query = useQuery({
    queryKey: ["paf-list"],
    queryFn: listPafs,
    staleTime: 60_000,
  });

  const submitted = useMemo(
    () =>
      (query.data?.pafs ?? []).filter(
        (p) =>
          p.submitter_id === memberId ||
          (p.submitter_email && p.submitter_email.toLowerCase() === memberEmail.toLowerCase())
      ),
    [query.data, memberId, memberEmail]
  );
  const mentioned = useMemo(() => {
    if (!memberName.trim()) return [];
    const needle = memberName.trim().toLowerCase();
    return (query.data?.pafs ?? []).filter(
      (p) =>
        p.employee_name &&
        p.employee_name.toLowerCase().includes(needle) &&
        p.submitter_id !== memberId
    );
  }, [query.data, memberName, memberId]);

  return (
    <Section title="PAF History">
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("submitted")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            tab === "submitted"
              ? "bg-midnight text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          Submitted ({submitted.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("mentioned")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            tab === "mentioned"
              ? "bg-midnight text-white"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
          }`}
        >
          Mentioned as employee ({mentioned.length})
        </button>
      </div>

      {query.isLoading ? (
        <div className="text-xs text-zinc-500">Loading PAFs…</div>
      ) : query.isError ? (
        <div className="text-xs text-red-700">Couldn't load PAFs.</div>
      ) : tab === "submitted" ? (
        submitted.length === 0 ? (
          <div className="text-xs text-zinc-500">
            No PAFs submitted by this person.
          </div>
        ) : (
          <PafTable rows={submitted} actions="view" />
        )
      ) : mentioned.length === 0 ? (
        <div className="text-xs text-zinc-500">
          No PAFs reference this employee. Soft match by name; collisions are
          possible if other employees share the name.
        </div>
      ) : (
        <PafTable rows={mentioned} actions="view" />
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-midnight">
        {title}
      </h4>
      {children}
    </div>
  );
}

function formatBirthdayShort(iso: string | null): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [_, mm, dd] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(mm, 10);
  if (m < 1 || m > 12) return null;
  return `${months[m - 1]} ${parseInt(dd, 10)}`;
}
