// Typed wrappers around netlify/functions/contacts.js and vendors.js.

import { supabase } from "@/lib/supabase";
import type {
  Contact,
  ContactKind,
  PosFilter,
  Tier,
  Vendor,
  VendorDoc,
} from "@/types/database";

const CONTACTS_FN = "/.netlify/functions/contacts";
const VENDORS_FN = "/.netlify/functions/vendors";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ----------------------------------------------------------------------------
// Contacts
// ----------------------------------------------------------------------------

export function listContacts(): Promise<{ contacts: Contact[] }> {
  return request(`${CONTACTS_FN}?action=list`);
}

export function getContact(id: string): Promise<{ contact: Contact }> {
  return request(`${CONTACTS_FN}?action=get&id=${encodeURIComponent(id)}`);
}

export interface ContactInput {
  display_name: string;
  contact_type?: ContactKind;
  phone?: string | null;
  extension?: string | null;
  email?: string | null;
  website?: string | null;
  category?: string | null;
  notes?: string | null;
  tier: Tier;
  region_id?: string | null;
  area_id?: string | null;
  district_id?: string | null;
  store_id?: string | null;
  vendor_id?: string | null;
  pos_filter?: PosFilter | null;
}

// Scope-options response — region/area/district/store choices the
// caller can target with a contact, plus which tiers they can write.
export interface ScopeOptionsResponse {
  regions:   { id: string; code: string; name: string | null }[];
  areas:     { id: string; code: string; name: string | null; region_id: string }[];
  districts: { id: string; code: string; name: string | null; area_id: string }[];
  stores:    { id: string; number: string; name: string | null; district_id: string }[];
  writeable_tiers: Tier[];
}

export function fetchScopeOptions(): Promise<ScopeOptionsResponse> {
  return request(`${CONTACTS_FN}?action=scope-options`);
}

export function createContact(input: ContactInput): Promise<{ contact: Contact }> {
  return request(`${CONTACTS_FN}?action=create`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateContact(
  id: string,
  patch: Partial<ContactInput>
): Promise<{ contact: Contact }> {
  return request(`${CONTACTS_FN}?action=update`, {
    method: "POST",
    body: JSON.stringify({ id, ...patch }),
  });
}

export function deleteContact(id: string): Promise<{ ok: true }> {
  return request(`${CONTACTS_FN}?action=delete`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function hideContact(id: string): Promise<{ ok: true }> {
  return request(`${CONTACTS_FN}?action=hide`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function unhideContact(id: string): Promise<{ ok: true }> {
  return request(`${CONTACTS_FN}?action=unhide`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function pinContact(id: string): Promise<{ ok: true; pinned: string[] }> {
  return request(`${CONTACTS_FN}?action=pin`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

export function unpinContact(id: string): Promise<{ ok: true; pinned: string[] }> {
  return request(`${CONTACTS_FN}?action=unpin`, {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

// ----------------------------------------------------------------------------
// Vendors (Phase 0: read-only here; full vendor editor lives in a future
// admin module / Work Orders rebuild)
// ----------------------------------------------------------------------------

export function getVendor(id: string): Promise<{ vendor: Vendor }> {
  return request(`${VENDORS_FN}?action=get&id=${encodeURIComponent(id)}`);
}

export function listVendorDocs(vendorId: string): Promise<{ docs: VendorDoc[] }> {
  return request(`${VENDORS_FN}?action=docs&vendor_id=${encodeURIComponent(vendorId)}`);
}
