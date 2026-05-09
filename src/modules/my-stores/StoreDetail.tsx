// Store detail view — leadership chain (DO/SDO/RVP) at the top, then a
// team members card listing GMs / Shift Managers assigned to this
// store. Each row in the team list opens the MemberProfileDrawer.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, MapPin, Pencil, Phone } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Drawer } from "@/shared/ui/Drawer";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import { updateStoreVendor, type VendorEditableFields } from "./api";
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
  onBack,
  onMemberClick,
}: {
  store: MyStoreNode;
  leadership: StoreLeadership | null;
  onBack?: () => void;
  onMemberClick: (m: MyStoreTeamMember) => void;
}) {
  return (
    <div className="space-y-4">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          Back
        </Button>
      )}

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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <LeadershipSlot label="General Manager" person={leadership.gm} />
              <LeadershipSlot label="Director of Operations" person={leadership.do} />
              <LeadershipSlot label="Sr. Director of Operations" person={leadership.sdo} />
              <LeadershipSlot label="Regional VP" person={leadership.rvp} />
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No leadership info available.</div>
          )}
        </CardBody>
      </Card>

      {/* Operations & vendor card */}
      <OperationsCard store={store} />


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

const ORG_WIDE_ROLES = new Set<UserRole>(["payroll", "admin", "vp", "coo"]);
const SCOPE_ROLES = new Set<UserRole>(["do", "sdo", "rvp"]);

function OperationsCard({ store }: { store: MyStoreNode }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [editing, setEditing] = useState(false);

  const canEditVendor = !!profile && (
    ORG_WIDE_ROLES.has(profile.role) ||
    SCOPE_ROLES.has(profile.role) ||
    (profile.role === "gm" && profile.primary_store_id === store.id)
  );

  const fields: { label: string; value: string | null; copy?: boolean; href?: string }[] = [
    { label: "Plate IQ Email", value: store.plate_iq_email, copy: true },
    { label: "Soar Company", value: store.soar_company_name },
  ];
  const vendor: { label: string; value: string | null; copy?: boolean; href?: string }[] = [
    { label: "Vendor", value: store.food_vendor_name },
    { label: "Contact", value: store.food_vendor_contact_name },
    {
      label: "Phone",
      value: store.food_vendor_contact_phone,
      href: store.food_vendor_contact_phone
        ? `tel:${store.food_vendor_contact_phone.replace(/[^0-9+]/g, "")}`
        : undefined,
    },
    { label: "Email", value: store.food_vendor_contact_email, copy: true },
    { label: "Account #", value: store.food_vendor_account_number, copy: true },
  ];

  const hasOps = fields.some((f) => f.value);
  const hasVendor = vendor.some((f) => f.value);

  function copy(value: string, label: string) {
    navigator.clipboard?.writeText(value).then(
      () => toast.push(`${label} copied.`, "success"),
      () => toast.push(`Couldn't copy ${label.toLowerCase()}.`, "error")
    );
  }

  const editAction = canEditVendor ? (
    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
      <Pencil className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
      Edit vendor
    </Button>
  ) : null;

  if (!hasOps && !hasVendor) {
    return (
      <>
        <Card>
          <CardHeader
            title="Operations & vendor"
            description="Plate IQ, Soar company, food vendor contact."
            actions={editAction}
          />
          <CardBody>
            <div className="text-sm text-zinc-500">
              No operations or vendor data on file for this store yet.
            </div>
          </CardBody>
        </Card>
        {canEditVendor && (
          <VendorEditDrawer
            open={editing}
            onClose={() => setEditing(false)}
            store={store}
          />
        )}
      </>
    );
  }

  return (
    <>
    <Card>
      <CardHeader
        title="Operations & vendor"
        description="Plate IQ, Soar company, food vendor contact."
        actions={editAction}
      />
      <CardBody className="space-y-4">
        {hasOps && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) =>
              f.value ? (
                <div key={f.label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {f.label}
                  </dt>
                  <dd className="mt-0.5 flex items-center gap-2 text-sm text-midnight">
                    <span className="break-all">{f.value}</span>
                    {f.copy && (
                      <button
                        type="button"
                        onClick={() => copy(f.value!, f.label)}
                        className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 transition hover:bg-zinc-200 hover:text-midnight"
                      >
                        <Mail className="h-3 w-3" strokeWidth={1.75} />
                        Copy
                      </button>
                    )}
                  </dd>
                </div>
              ) : null
            )}
          </dl>
        )}
        {hasVendor && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Food vendor
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {vendor.map((f) =>
                f.value ? (
                  <div key={f.label}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      {f.label}
                    </dt>
                    <dd className="mt-0.5 flex items-center gap-2 text-sm text-midnight">
                      {f.href ? (
                        <a href={f.href} className="text-accent hover:underline">
                          {f.value}
                        </a>
                      ) : (
                        <span className="break-all">{f.value}</span>
                      )}
                      {f.copy && (
                        <button
                          type="button"
                          onClick={() => copy(f.value!, f.label)}
                          className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 transition hover:bg-zinc-200 hover:text-midnight"
                        >
                          <Mail className="h-3 w-3" strokeWidth={1.75} />
                          Copy
                        </button>
                      )}
                    </dd>
                  </div>
                ) : null
              )}
            </dl>
          </div>
        )}
      </CardBody>
    </Card>
    {canEditVendor && (
      <VendorEditDrawer
        open={editing}
        onClose={() => setEditing(false)}
        store={store}
      />
    )}
    </>
  );
}

function VendorEditDrawer({
  open,
  onClose,
  store,
}: {
  open: boolean;
  onClose: () => void;
  store: MyStoreNode;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [form, setForm] = useState<Record<keyof VendorEditableFields, string>>({
    food_vendor_name: store.food_vendor_name ?? "",
    food_vendor_contact_name: store.food_vendor_contact_name ?? "",
    food_vendor_contact_phone: store.food_vendor_contact_phone ?? "",
    food_vendor_contact_email: store.food_vendor_contact_email ?? "",
    food_vendor_account_number: store.food_vendor_account_number ?? "",
  });

  // Reset form whenever the drawer is reopened or the store changes,
  // so stale typed-but-not-saved input doesn't carry over.
  useEffect(() => {
    if (!open) return;
    setForm({
      food_vendor_name: store.food_vendor_name ?? "",
      food_vendor_contact_name: store.food_vendor_contact_name ?? "",
      food_vendor_contact_phone: store.food_vendor_contact_phone ?? "",
      food_vendor_contact_email: store.food_vendor_contact_email ?? "",
      food_vendor_account_number: store.food_vendor_account_number ?? "",
    });
  }, [open, store.id, store.food_vendor_name, store.food_vendor_contact_name, store.food_vendor_contact_phone, store.food_vendor_contact_email, store.food_vendor_account_number]);

  const mut = useMutation({
    mutationFn: () => updateStoreVendor(store.id, form),
    onSuccess: (data) => {
      toast.push(
        data.changed > 0 ? "Vendor info saved." : "No changes to save.",
        "success"
      );
      qc.invalidateQueries({ queryKey: ["my-stores-tree"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  function set<K extends keyof VendorEditableFields>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit vendor — Store #${store.number}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
          >
            {mut.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-zinc-500">
          Plate IQ Email and Soar Company are admin-only and not editable here.
        </p>
        <div>
          <Label htmlFor="vf-name">Vendor</Label>
          <Input
            id="vf-name"
            value={form.food_vendor_name}
            onChange={(e) => set("food_vendor_name", e.target.value)}
            placeholder="Sysco, US Foods, etc."
          />
        </div>
        <div>
          <Label htmlFor="vf-contact">Contact name</Label>
          <Input
            id="vf-contact"
            value={form.food_vendor_contact_name}
            onChange={(e) => set("food_vendor_contact_name", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="vf-phone">Contact phone</Label>
          <Input
            id="vf-phone"
            type="tel"
            inputMode="tel"
            value={form.food_vendor_contact_phone}
            onChange={(e) => set("food_vendor_contact_phone", e.target.value)}
            placeholder="(555) 123-4567 ext 99"
          />
        </div>
        <div>
          <Label htmlFor="vf-email">Contact email</Label>
          <Input
            id="vf-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="off"
            value={form.food_vendor_contact_email}
            onChange={(e) => set("food_vendor_contact_email", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="vf-acct">Account #</Label>
          <Input
            id="vf-acct"
            value={form.food_vendor_account_number}
            onChange={(e) => set("food_vendor_account_number", e.target.value)}
          />
        </div>
      </div>
    </Drawer>
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
