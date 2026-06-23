// Store detail view — leadership chain (DO/SDO/RVP) at the top, then a
// team members card listing GMs / Shift Managers assigned to this
// store. Each row in the team list opens the MemberProfileDrawer.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Mail, MapPin, Pencil, Phone, Plus, Settings, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { ReplacementsTab } from "@/modules/work-orders-v2/ReplacementsTab";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Drawer } from "@/shared/ui/Drawer";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { ROLE_LABELS, type UserRole } from "@/types/database";
import { formatPhoneForDisplay } from "@/lib/phone";
import {
  fetchStoreVendorAudit,
  updateStoreAttributes,
  updateStoreVendor,
  type StoreAttributesEditableFields,
  type StoreVendorAuditEntry,
  type VendorEditableFields,
} from "./api";
import type {
  CustomAttributes,
  CustomAttributeValue,
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

function formatDateLong(iso: string | null): string | null {
  if (!iso) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  if (m < 1 || m > 12) return iso;
  return `${months[m - 1]} ${d}, ${y}`;
}

const ATTRIBUTE_EDITOR_ROLES = new Set<UserRole>([
  "admin", "payroll", "vp", "coo", "do", "sdo", "rvp",
]);

// Render a CustomAttributeValue for display. We coerce to string but
// keep an italic placeholder for empty values so the read-mode card
// doesn't render a bare key with nothing beside it.
function formatCustomValue(value: CustomAttributeValue): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
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
  const { profile } = useAuth();
  const canEditAttributes = !!profile && ATTRIBUTE_EDITOR_ROLES.has(profile.role);
  const [attributesOpen, setAttributesOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            Back
          </Button>
        ) : (
          <span />
        )}
        {canEditAttributes && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAttributesOpen(true)}
            aria-label="Manage store attributes"
            title="Manage store attributes"
          >
            <Settings className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            Manage attributes
          </Button>
        )}
      </div>

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
              {(store.phone || store.email) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
                  {store.phone && (
                    <a
                      href={`tel:${store.phone.replace(/[^0-9+]/g, "")}`}
                      className="inline-flex items-center gap-1.5 hover:text-midnight"
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />
                      {formatPhoneForDisplay(store.phone)}
                    </a>
                  )}
                  {store.email && (
                    <a
                      href={`mailto:${store.email}`}
                      className="inline-flex items-center gap-1.5 break-all hover:text-midnight"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />
                      {store.email}
                    </a>
                  )}
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

      {/* Replacement equipment ordered for this store. Renders
          nothing when there are no replacements; otherwise shows a
          compact table embedded from the WO2 module. */}
      <Card>
        <CardHeader
          title="Replacements"
          description="Equipment ordered for this store via the Order Replacement action on a work order."
        />
        <CardBody>
          <ReplacementsTab
            storeNumber={store.number}
            storeId={store.id}
            hideStoreColumn
            compact
          />
        </CardBody>
      </Card>

      {/* Store attributes (read-only here; editable from Org admin) */}
      <StoreAttributesCard store={store} />

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

      {canEditAttributes && (
        <AttributesEditDrawer
          open={attributesOpen}
          onClose={() => setAttributesOpen(false)}
          store={store}
        />
      )}
    </div>
  );
}

const ORG_WIDE_ROLES = new Set<UserRole>(["payroll", "admin", "vp", "coo"]);
const SCOPE_ROLES = new Set<UserRole>(["do", "sdo", "rvp"]);

function OperationsCard({ store }: { store: MyStoreNode }) {
  const toast = useToast();
  const { profile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // GMs/DOs/SDOs/RVPs can edit any store inside their visible scope.
  // We don't gate the GM on profile.primary_store_id because some GMs
  // are scoped via user_scopes without primary_store_id populated, and
  // the my-tree response is already pre-filtered to their visible set.
  const canEditVendor = !!profile && (
    ORG_WIDE_ROLES.has(profile.role) ||
    SCOPE_ROLES.has(profile.role) ||
    profile.role === "gm"
  );
  const canViewHistory = profile?.role === "admin";

  const fields: { label: string; value: string | null; copy?: boolean; href?: string }[] = [
    { label: "Plate IQ Email", value: store.plate_iq_email, copy: true },
    { label: "Soar Company", value: store.soar_company_name },
    { label: "Pay Cycle", value: store.pay_cycle ? `Period ${store.pay_cycle}` : null },
    { label: "POS", value: store.pos_provider },
    { label: "Security Vendor", value: store.security_vendor },
    {
      label: "Security Contact",
      value: store.security_vendor_phone,
      href: store.security_vendor_phone
        ? `tel:${store.security_vendor_phone.replace(/[^0-9+]/g, "")}`
        : undefined,
    },
    { label: "Acquisition Date", value: formatDateLong(store.acquisition_date) },
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

  const editAction = (canEditVendor || canViewHistory) ? (
    <div className="flex gap-1">
      {canViewHistory && (
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <ClipboardList className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          History
        </Button>
      )}
      {canEditVendor && (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
          Edit vendor
        </Button>
      )}
    </div>
  ) : null;

  if (!hasOps && !hasVendor) {
    return (
      <>
        <Card>
          <CardHeader
            title="Operations & vendor"
            description="Plate IQ, Soar company, POS, security, acquisition, food vendor contact."
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
        {canViewHistory && (
          <VendorHistoryDrawer
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
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

function VendorHistoryDrawer({
  open,
  onClose,
  store,
}: {
  open: boolean;
  onClose: () => void;
  store: MyStoreNode;
}) {
  const query = useQuery({
    queryKey: ["store-vendor-audit", store.id],
    queryFn: () => fetchStoreVendorAudit(store.id, 100),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Vendor history — Store #${store.number}`}
    >
      {query.isLoading && (
        <div className="text-sm text-zinc-500">Loading…</div>
      )}
      {query.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(query.error as Error)?.message ?? "Couldn't load history."}
        </div>
      )}
      {query.data && query.data.entries.length === 0 && (
        <div className="text-sm text-zinc-500">
          No vendor edits recorded for this store yet.
        </div>
      )}
      {query.data && query.data.entries.length > 0 && (
        <ul className="space-y-3">
          {query.data.entries.map((e) => (
            <VendorAuditRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

const VENDOR_FIELD_LABELS: Record<string, string> = {
  food_vendor_name: "Vendor",
  food_vendor_contact_name: "Contact name",
  food_vendor_contact_phone: "Contact phone",
  food_vendor_contact_email: "Contact email",
  food_vendor_account_number: "Account #",
};

function VendorAuditRow({ entry }: { entry: StoreVendorAuditEntry }) {
  const when = new Date(entry.created_at);
  const whenStr = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const actor =
    entry.actor.name || entry.actor_email || "Unknown user";
  return (
    <li className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-midnight">
          {VENDOR_FIELD_LABELS[entry.field] ?? entry.field}
        </span>
        <span className="text-zinc-500">{whenStr}</span>
      </div>
      <div className="mt-1 text-zinc-600">
        by <span className="font-medium text-midnight">{actor}</span>
        {entry.actor.role && (
          <span className="ml-1 text-zinc-400">
            ({ROLE_LABELS[entry.actor.role as UserRole] ?? entry.actor.role})
          </span>
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            Before
          </div>
          <div className="break-all text-zinc-700">
            {entry.old_value ?? <span className="italic text-zinc-400">empty</span>}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            After
          </div>
          <div className="break-all text-zinc-700">
            {entry.new_value ?? <span className="italic text-zinc-400">empty</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

// Display labels for the boolean attribute keys, kept in render order.
const PROGRAM_LABELS: { key: keyof MyStoreNode; label: string }[] = [
  { key: "has_apple_pay",       label: "Apple Pay" },
  { key: "has_order_ahead",     label: "Order Ahead" },
  { key: "has_outdoor_seating", label: "Outdoor seating" },
  { key: "has_drive_thru",      label: "Drive-thru" },
  { key: "has_clearance_bar",   label: "Drive-thru clearance bar" },
];

const THIRD_PARTY_LABELS: Record<string, string> = {
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  ezcater: "EzCater",
  postmates: "Postmates",
};

const DRIVE_THRU_TYPE_LABELS: Record<string, string> = {
  single_pole_two_menus: "Single pole, two menus",
  split_housing: "Split housing",
};

function StoreAttributesCard({ store }: { store: MyStoreNode }) {
  const enabledPrograms = PROGRAM_LABELS.filter((p) => store[p.key] === true);
  const providers = store.third_party_delivery ?? [];
  const customAttrs = store.attributes ?? {};
  const customAttrEntries = Object.entries(customAttrs);

  // Hide the card if NOTHING is set — keeps newly-onboarded stores
  // from showing a sea of empty rows.
  const hasAnyAttributes =
    enabledPrograms.length > 0 ||
    providers.length > 0 ||
    store.public_restroom_count > 0 ||
    store.patio_pop_menu_count > 0 ||
    store.order_ahead_stall_count > 0 ||
    store.stall_pop_menu_count > 0 ||
    store.has_trailer_stall ||
    !!store.drive_thru_type ||
    !!store.drive_thru_lanes ||
    customAttrEntries.length > 0;

  if (!hasAnyAttributes) return null;

  return (
    <Card>
      <CardHeader
        title="Store attributes"
        description="Programs, drive-thru, restrooms, stall data, custom fields."
      />
      <CardBody className="space-y-4">
        {/* Active programs */}
        {(enabledPrograms.length > 0 || store.drive_thru_lanes) && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Active programs
            </div>
            <div className="flex flex-wrap gap-1.5">
              {enabledPrograms.map((p) => (
                <Badge key={p.key as string} tone="success">{p.label}</Badge>
              ))}
              {store.has_drive_thru && store.drive_thru_lanes && (
                <Badge tone="info">
                  {store.drive_thru_lanes === 2 ? "Double" : "Single"} lane
                </Badge>
              )}
              {store.has_drive_thru && store.drive_thru_type && (
                <Badge tone="info">
                  {DRIVE_THRU_TYPE_LABELS[store.drive_thru_type] ?? store.drive_thru_type}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Third-party delivery */}
        {providers.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Third-party delivery
            </div>
            <div className="flex flex-wrap gap-1.5">
              {providers.map((p) => (
                <Badge key={p} tone="neutral">
                  {THIRD_PARTY_LABELS[p] ?? p}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Counts grid */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {store.public_restroom_count > 0 && (
            <Stat label="Public restrooms" value={String(store.public_restroom_count)} />
          )}
          {store.patio_pop_menu_count > 0 && (
            <Stat label="Patio POP menus" value={String(store.patio_pop_menu_count)} />
          )}
          {store.order_ahead_stall_count > 0 && (
            <Stat label="Order Ahead stalls" value={String(store.order_ahead_stall_count)} />
          )}
          {store.stall_pop_menu_count > 0 && (
            <Stat label="Stall POP menus" value={String(store.stall_pop_menu_count)} />
          )}
        </dl>

        {/* Stall numbers (free-text lists) */}
        {(store.patio_pop_stall_numbers ||
          store.order_ahead_stall_numbers ||
          store.has_trailer_stall) && (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {store.patio_pop_stall_numbers && (
              <Stat label="Patio POP stall #s" value={store.patio_pop_stall_numbers} />
            )}
            {store.order_ahead_stall_numbers && (
              <Stat label="Order Ahead stall #s" value={store.order_ahead_stall_numbers} />
            )}
            {store.has_trailer_stall && (
              <Stat
                label="Trailer stall"
                value={store.trailer_stall_number || "Yes"}
              />
            )}
          </dl>
        )}

        {/* Custom attributes (free-form) */}
        {customAttrEntries.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Custom attributes
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {customAttrEntries
                .slice()
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => (
                  <Stat key={k} label={k} value={formatCustomValue(v)} />
                ))}
            </dl>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-midnight">{value}</dd>
    </div>
  );
}

const ATTR_THIRD_PARTY_PROVIDERS: { key: string; label: string }[] = [
  { key: "doordash", label: "DoorDash" },
  { key: "ubereats", label: "Uber Eats" },
  { key: "grubhub", label: "Grubhub" },
  { key: "ezcater", label: "EzCater" },
  { key: "postmates", label: "Postmates" },
];

const ATTR_DRIVE_THRU_TYPES: { key: string; label: string }[] = [
  { key: "single_pole_two_menus", label: "Single pole, two menus" },
  { key: "split_housing", label: "Split housing" },
];

// Editor row shape — we keep an explicit array of { key, value } rows
// rather than the object form so duplicates / empty keys can exist
// during editing without immediately overwriting each other. The save
// step collapses to an object.
interface CustomAttrRow {
  key: string;
  value: string;
}

const CUSTOM_ATTR_MAX_KEYS = 50;
const CUSTOM_ATTR_MAX_KEY_LENGTH = 64;
const CUSTOM_ATTR_MAX_VALUE_LENGTH = 500;

function attributesObjectToRows(attrs: CustomAttributes | undefined): CustomAttrRow[] {
  if (!attrs) return [];
  return Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      value:
        value === null || value === undefined
          ? ""
          : typeof value === "boolean"
            ? value ? "true" : "false"
            : String(value),
    }));
}

// Build the object we'll send to the server. Drops rows whose key is
// blank (those are still being typed), trims keys, and rejects duplicates
// by returning an error string. Caller decides how to surface the error.
function rowsToAttributesObject(
  rows: CustomAttrRow[]
): { ok: true; value: CustomAttributes } | { ok: false; error: string } {
  const out: CustomAttributes = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const trimmed = row.key.trim();
    if (!trimmed) continue; // skip in-progress empty keys
    if (trimmed.length > CUSTOM_ATTR_MAX_KEY_LENGTH) {
      return {
        ok: false,
        error: `Attribute key "${trimmed.slice(0, 20)}…" is too long (max ${CUSTOM_ATTR_MAX_KEY_LENGTH}).`,
      };
    }
    if (row.value.length > CUSTOM_ATTR_MAX_VALUE_LENGTH) {
      return {
        ok: false,
        error: `Value for "${trimmed}" is too long (max ${CUSTOM_ATTR_MAX_VALUE_LENGTH}).`,
      };
    }
    if (seen.has(trimmed)) {
      return { ok: false, error: `Duplicate attribute key: "${trimmed}".` };
    }
    seen.add(trimmed);
    out[trimmed] = row.value;
  }
  if (Object.keys(out).length > CUSTOM_ATTR_MAX_KEYS) {
    return {
      ok: false,
      error: `Too many custom attributes (max ${CUSTOM_ATTR_MAX_KEYS}).`,
    };
  }
  return { ok: true, value: out };
}

function AttributesEditDrawer({
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

  const [hasApplePay, setHasApplePay] = useState(false);
  const [hasOrderAhead, setHasOrderAhead] = useState(false);
  const [hasOutdoorSeating, setHasOutdoorSeating] = useState(false);
  const [hasDriveThru, setHasDriveThru] = useState(false);
  const [hasClearanceBar, setHasClearanceBar] = useState(false);
  const [driveThruLanes, setDriveThruLanes] = useState<string>("");
  const [driveThruType, setDriveThruType] = useState<string>("");
  const [publicRestroomCount, setPublicRestroomCount] = useState<string>("0");
  const [patioPopMenuCount, setPatioPopMenuCount] = useState<string>("0");
  const [patioPopStallNumbers, setPatioPopStallNumbers] = useState("");
  const [orderAheadStallCount, setOrderAheadStallCount] = useState<string>("0");
  const [orderAheadStallNumbers, setOrderAheadStallNumbers] = useState("");
  const [stallPopMenuCount, setStallPopMenuCount] = useState<string>("0");
  const [hasTrailerStall, setHasTrailerStall] = useState(false);
  const [trailerStallNumber, setTrailerStallNumber] = useState("");
  const [thirdPartyDelivery, setThirdPartyDelivery] = useState<string[]>([]);
  const [customAttrRows, setCustomAttrRows] = useState<CustomAttrRow[]>([]);

  // Hydrate from the store whenever the drawer opens or the store changes.
  useEffect(() => {
    if (!open) return;
    setHasApplePay(!!store.has_apple_pay);
    setHasOrderAhead(!!store.has_order_ahead);
    setHasOutdoorSeating(!!store.has_outdoor_seating);
    setHasDriveThru(!!store.has_drive_thru);
    setHasClearanceBar(!!store.has_clearance_bar);
    setDriveThruLanes(store.drive_thru_lanes != null ? String(store.drive_thru_lanes) : "");
    setDriveThruType(store.drive_thru_type ?? "");
    setPublicRestroomCount(String(store.public_restroom_count ?? 0));
    setPatioPopMenuCount(String(store.patio_pop_menu_count ?? 0));
    setPatioPopStallNumbers(store.patio_pop_stall_numbers ?? "");
    setOrderAheadStallCount(String(store.order_ahead_stall_count ?? 0));
    setOrderAheadStallNumbers(store.order_ahead_stall_numbers ?? "");
    setStallPopMenuCount(String(store.stall_pop_menu_count ?? 0));
    setHasTrailerStall(!!store.has_trailer_stall);
    setTrailerStallNumber(store.trailer_stall_number ?? "");
    setThirdPartyDelivery(Array.isArray(store.third_party_delivery) ? store.third_party_delivery : []);
    setCustomAttrRows(attributesObjectToRows(store.attributes));
  }, [open, store]);

  const mut = useMutation({
    mutationFn: () => {
      const built = rowsToAttributesObject(customAttrRows);
      if (!built.ok) {
        // Throw so onError surfaces the validation message — keeps the
        // mutation API surface consistent with server errors.
        throw new Error(built.error);
      }
      const fields: Partial<StoreAttributesEditableFields> = {
        has_apple_pay: hasApplePay,
        has_order_ahead: hasOrderAhead,
        has_outdoor_seating: hasOutdoorSeating,
        has_drive_thru: hasDriveThru,
        has_clearance_bar: hasClearanceBar,
        drive_thru_lanes: driveThruLanes ? parseInt(driveThruLanes, 10) : null,
        drive_thru_type: driveThruType || null,
        public_restroom_count: parseInt(publicRestroomCount || "0", 10) || 0,
        patio_pop_menu_count: parseInt(patioPopMenuCount || "0", 10) || 0,
        patio_pop_stall_numbers: patioPopStallNumbers.trim() || null,
        order_ahead_stall_count: parseInt(orderAheadStallCount || "0", 10) || 0,
        order_ahead_stall_numbers: orderAheadStallNumbers.trim() || null,
        stall_pop_menu_count: parseInt(stallPopMenuCount || "0", 10) || 0,
        has_trailer_stall: hasTrailerStall,
        trailer_stall_number: trailerStallNumber.trim() || null,
        third_party_delivery: thirdPartyDelivery,
        attributes: built.value,
      };
      return updateStoreAttributes(store.id, fields);
    },
    onSuccess: () => {
      toast.push("Store attributes saved.", "success");
      qc.invalidateQueries({ queryKey: ["my-stores-tree"] });
      onClose();
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Save failed.", "error"),
  });

  function updateCustomRow(index: number, patch: Partial<CustomAttrRow>) {
    setCustomAttrRows((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r))
    );
  }
  function addCustomRow() {
    setCustomAttrRows((rows) => [...rows, { key: "", value: "" }]);
  }
  function removeCustomRow(index: number) {
    setCustomAttrRows((rows) => rows.filter((_, i) => i !== index));
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Store attributes — Store #${store.number}`}
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
      <div className="space-y-5">
        {/* Active programs */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Active programs
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <AttrToggle label="Apple Pay" checked={hasApplePay} onChange={setHasApplePay} />
            <AttrToggle label="Order Ahead" checked={hasOrderAhead} onChange={setHasOrderAhead} />
            <AttrToggle label="Outdoor seating" checked={hasOutdoorSeating} onChange={setHasOutdoorSeating} />
            <AttrToggle label="Drive-thru" checked={hasDriveThru} onChange={setHasDriveThru} />
          </div>
        </div>

        {hasDriveThru && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="attr-dt-lanes">Drive-thru lanes</Label>
                <select
                  id="attr-dt-lanes"
                  value={driveThruLanes}
                  onChange={(e) => setDriveThruLanes(e.target.value)}
                  className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">—</option>
                  <option value="1">Single (1 lane)</option>
                  <option value="2">Double (2 lanes)</option>
                </select>
              </div>
              <div>
                <Label htmlFor="attr-dt-type">Drive-thru type</Label>
                <select
                  id="attr-dt-type"
                  value={driveThruType}
                  onChange={(e) => setDriveThruType(e.target.value)}
                  className="block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">—</option>
                  {ATTR_DRIVE_THRU_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <AttrToggle label="Clearance bar" checked={hasClearanceBar} onChange={setHasClearanceBar} />
          </div>
        )}

        <div>
          <Label htmlFor="attr-restrooms">Public restrooms</Label>
          <Input
            id="attr-restrooms"
            type="number"
            min={0}
            max={99}
            value={publicRestroomCount}
            onChange={(e) => setPublicRestroomCount(e.target.value)}
          />
        </div>

        {/* Stall data */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Stall data
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="attr-patio-pop"># Patio POP menus</Label>
              <Input
                id="attr-patio-pop"
                type="number"
                min={0}
                value={patioPopMenuCount}
                onChange={(e) => setPatioPopMenuCount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="attr-patio-pop-stalls">Patio POP stall #s</Label>
              <Input
                id="attr-patio-pop-stalls"
                value={patioPopStallNumbers}
                onChange={(e) => setPatioPopStallNumbers(e.target.value)}
                placeholder="e.g. 1,2,3,4"
              />
            </div>
            <div>
              <Label htmlFor="attr-oa-count"># Order Ahead stalls</Label>
              <Input
                id="attr-oa-count"
                type="number"
                min={0}
                value={orderAheadStallCount}
                onChange={(e) => setOrderAheadStallCount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="attr-oa-stalls">Order Ahead stall #s</Label>
              <Input
                id="attr-oa-stalls"
                value={orderAheadStallNumbers}
                onChange={(e) => setOrderAheadStallNumbers(e.target.value)}
                placeholder="e.g. 5,6"
              />
            </div>
            <div>
              <Label htmlFor="attr-stall-pop"># Stall POP menus</Label>
              <Input
                id="attr-stall-pop"
                type="number"
                min={0}
                value={stallPopMenuCount}
                onChange={(e) => setStallPopMenuCount(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <AttrToggle label="Trailer stall" checked={hasTrailerStall} onChange={setHasTrailerStall} />
            </div>
          </div>
          {hasTrailerStall && (
            <div className="mt-3">
              <Label htmlFor="attr-trailer-num">Trailer stall #</Label>
              <Input
                id="attr-trailer-num"
                value={trailerStallNumber}
                onChange={(e) => setTrailerStallNumber(e.target.value)}
                placeholder="e.g. 12"
              />
            </div>
          )}
        </div>

        {/* Third-party delivery */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Third-party delivery
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {ATTR_THIRD_PARTY_PROVIDERS.map((p) => (
              <AttrToggle
                key={p.key}
                label={p.label}
                checked={thirdPartyDelivery.includes(p.key)}
                onChange={(next) => {
                  setThirdPartyDelivery((cur) =>
                    next ? [...cur, p.key] : cur.filter((k) => k !== p.key)
                  );
                }}
              />
            ))}
          </div>
        </div>

        {/* Custom attributes (free-form bag) */}
        <div>
          <div className="mb-2 flex items-end justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Custom attributes
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                Free-form key/value pairs. Up to {CUSTOM_ATTR_MAX_KEYS} entries.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={addCustomRow}
              disabled={customAttrRows.length >= CUSTOM_ATTR_MAX_KEYS}
            >
              <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
              Add
            </Button>
          </div>
          {customAttrRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-500">
              No custom attributes yet.
            </div>
          ) : (
            <div className="space-y-2">
              {customAttrRows.map((row, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_auto] gap-2 items-start"
                >
                  <Input
                    aria-label={`Attribute ${i + 1} key`}
                    value={row.key}
                    onChange={(e) => updateCustomRow(i, { key: e.target.value })}
                    placeholder="key"
                    maxLength={CUSTOM_ATTR_MAX_KEY_LENGTH}
                  />
                  <Input
                    aria-label={`Attribute ${i + 1} value`}
                    value={row.value}
                    onChange={(e) => updateCustomRow(i, { value: e.target.value })}
                    placeholder="value"
                    maxLength={CUSTOM_ATTR_MAX_VALUE_LENGTH}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCustomRow(i)}
                    aria-label={`Delete attribute ${i + 1}`}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function AttrToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-800">
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
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
