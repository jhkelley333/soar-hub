// Contact detail drawer — opens from any contact row. Read-only view
// of the full record, plus per-user actions: hide for my store (regional
// only), edit (if the caller can write to this tier+scope), and a small
// vendor sub-card when the contact is bridged to a vendor record.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, EyeOff, Eye } from "lucide-react";
import { Drawer } from "@/shared/ui/Drawer";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { useAuth } from "@/auth/AuthProvider";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { Contact, Tier } from "@/types/database";
import {
  getContact,
  getVendor,
  hideContact,
  unhideContact,
} from "./api";

const TIER_LABEL: Record<Tier, string> = {
  company: "Company",
  regional: "Regional",
  store: "Store",
};

const TIER_TONE: Record<Tier, "info" | "warning" | "neutral"> = {
  company: "info",
  regional: "warning",
  store: "neutral",
};

// Mirror of the server-side write rules in netlify/functions/contacts.js.
// UI hint only; server is the source of truth.
function callerCanEdit(
  role: string | undefined,
  primaryStoreId: string | null | undefined,
  contact: Contact
): boolean {
  if (!role) return false;
  if (["admin", "payroll", "vp", "coo"].includes(role)) return true;
  if (contact.tier === "company") return false;
  if (contact.tier === "regional") {
    return ["do", "sdo", "rvp"].includes(role);
  }
  if (contact.tier === "store") {
    return ["do", "sdo", "rvp", "gm"].includes(role)
      && (role !== "gm" || primaryStoreId === contact.store_id);
  }
  return false;
}

export function ContactDetailDrawer({
  contactId,
  onClose,
  onEdit,
}: {
  contactId: string | null;
  onClose: () => void;
  onEdit: (c: Contact) => void;
}) {
  const open = !!contactId;
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();

  const query = useQuery({
    queryKey: ["contact", contactId],
    queryFn: () => getContact(contactId!),
    enabled: open && !!contactId,
    staleTime: 30_000,
  });

  const contact = query.data?.contact ?? null;
  const isVendor = contact?.contact_type === "vendor" && !!contact.vendor_id;

  const vendorQuery = useQuery({
    queryKey: ["vendor", contact?.vendor_id],
    queryFn: () => getVendor(contact!.vendor_id!),
    enabled: open && !!contact?.vendor_id,
    staleTime: 60_000,
  });

  const isHiddenForMe = !!(
    contact &&
    contact.tier === "regional" &&
    profile?.primary_store_id &&
    contact.hidden_for_store_ids.includes(profile.primary_store_id)
  );

  const hideMut = useMutation({
    mutationFn: () =>
      isHiddenForMe ? unhideContact(contact!.id) : hideContact(contact!.id),
    onSuccess: () => {
      toast.push(isHiddenForMe ? "Unhidden." : "Hidden for your store.", "success");
      qc.invalidateQueries({ queryKey: ["contacts-list"] });
      qc.invalidateQueries({ queryKey: ["contact", contact?.id] });
    },
    onError: (e: unknown) =>
      toast.push(e instanceof Error ? e.message : "Couldn't update.", "error"),
  });

  const canEdit = !!contact && callerCanEdit(profile?.role, profile?.primary_store_id, contact);
  const canHide =
    !!contact &&
    contact.tier === "regional" &&
    !!profile?.primary_store_id;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={contact?.display_name ?? "Contact"}
      footer={
        canEdit && contact ? (
          <Button variant="primary" onClick={() => onEdit(contact)}>
            <Edit3 className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
            Edit
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {query.isLoading && <div className="text-sm text-zinc-500">Loading…</div>}
      {query.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(query.error as Error)?.message ?? "Couldn't load contact."}
        </div>
      )}
      {contact && (
        <div className="space-y-4">
          {/* Header chips */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TIER_TONE[contact.tier]}>{TIER_LABEL[contact.tier]}</Badge>
            {contact.category && <Badge tone="neutral">{contact.category}</Badge>}
            {contact.pos_filter && (
              <Badge tone="neutral">
                {contact.pos_filter === "infor" ? "Infor" : "Micros"}
              </Badge>
            )}
            {isVendor && <Badge tone="success">Vendor</Badge>}
          </div>

          {/* Contact fields */}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {contact.phone && (
              <Field label="Phone">
                <a
                  href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}
                  className="text-accent hover:underline"
                >
                  {formatPhoneForDisplay(contact.phone)}
                </a>
                {contact.extension && (
                  <span className="text-zinc-500"> ext {contact.extension}</span>
                )}
              </Field>
            )}
            {contact.email && (
              <Field label="Email">
                <a
                  href={`mailto:${contact.email}`}
                  className="text-accent hover:underline break-all"
                >
                  {contact.email}
                </a>
              </Field>
            )}
            {contact.website && (
              <Field label="Website">
                <a
                  href={
                    contact.website.startsWith("http")
                      ? contact.website
                      : `https://${contact.website}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline break-all"
                >
                  {contact.website}
                </a>
              </Field>
            )}
          </dl>

          {contact.notes && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Notes
              </div>
              <p className="mt-0.5 whitespace-pre-line text-sm text-zinc-700">
                {contact.notes}
              </p>
            </div>
          )}

          {/* Vendor sub-card if bridged */}
          {isVendor && vendorQuery.data?.vendor && (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Vendor record
              </div>
              <div className="mt-1 text-sm font-medium text-midnight">
                {vendorQuery.data.vendor.company_name}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-600">
                {vendorQuery.data.vendor.trade_category && (
                  <div>Trade: {vendorQuery.data.vendor.trade_category}</div>
                )}
                {vendorQuery.data.vendor.preferred && (
                  <div className="text-emerald-700">Preferred</div>
                )}
                {vendorQuery.data.vendor.w9_on_file && <div>W-9 on file</div>}
                {vendorQuery.data.vendor.insurance_expiry && (
                  <div>
                    Insurance expires {vendorQuery.data.vendor.insurance_expiry}
                  </div>
                )}
                {vendorQuery.data.vendor.response_time_hours != null && (
                  <div>~{vendorQuery.data.vendor.response_time_hours}h response</div>
                )}
              </div>
            </div>
          )}

          {/* Hide / unhide for my store (regional only) */}
          {canHide && (
            <div className="border-t border-zinc-100 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => hideMut.mutate()}
                disabled={hideMut.isPending}
              >
                {isHiddenForMe ? (
                  <>
                    <Eye className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                    Unhide for my store
                  </>
                ) : (
                  <>
                    <EyeOff className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                    Hide for my store
                  </>
                )}
              </Button>
              <p className="mt-1 text-[11px] text-zinc-500">
                Only affects your store's view. Other stores in the region
                continue to see this contact.
              </p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-midnight">{children}</dd>
    </div>
  );
}
