// Shared types for the My Stores module — mirror the JSON shapes
// returned by /netlify/functions/org.js.

export interface MyStoreTeamMember {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  preferred_name: string | null;
  role: string;
  primary_store_id: string | null;
  is_active: boolean;
  birthday: string | null;
  show_birthday: boolean;
  profile_photo_url: string | null;
}

export type DriveThruType = "single_pole_two_menus" | "split_housing";

// Free-form key/value bag stored on stores.attributes (jsonb). Keys are
// admin-defined strings; values are scalars (we render as strings in v1).
export type CustomAttributeValue = string | number | boolean | null;
export type CustomAttributes = Record<string, CustomAttributeValue>;

export interface MyStoreNode {
  id: string;
  number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  district_id: string | null;
  is_active: boolean;
  plate_iq_email: string | null;
  soar_company_name: string | null;
  pay_cycle: string | null;
  acquisition_date: string | null;
  pos_provider: string | null;
  security_vendor: string | null;
  security_vendor_phone: string | null;
  food_vendor_name: string | null;
  food_vendor_contact_name: string | null;
  food_vendor_contact_phone: string | null;
  food_vendor_contact_email: string | null;
  food_vendor_account_number: string | null;
  // Active programs
  has_apple_pay: boolean;
  has_order_ahead: boolean;
  has_outdoor_seating: boolean;
  has_drive_thru: boolean;
  has_clearance_bar: boolean;
  drive_thru_lanes: number | null;
  drive_thru_type: DriveThruType | null;
  public_restroom_count: number;
  // Stall data
  patio_pop_menu_count: number;
  patio_pop_stall_numbers: string | null;
  order_ahead_stall_count: number;
  order_ahead_stall_numbers: string | null;
  stall_pop_menu_count: number;
  has_trailer_stall: boolean;
  trailer_stall_number: string | null;
  third_party_delivery: string[];
  // Free-form admin-defined attributes. Default `{}` on new stores.
  attributes: CustomAttributes;
  team_members: MyStoreTeamMember[];
}

export interface MyDistrictNode {
  id: string;
  code: string | null;
  name: string | null;
  area_id: string | null;
  is_active: boolean;
  stores: MyStoreNode[];
}

export interface MyAreaNode {
  id: string;
  code: string | null;
  name: string | null;
  region_id: string | null;
  is_active: boolean;
  districts: MyDistrictNode[];
}

export interface MyRegionNode {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean;
  areas: MyAreaNode[];
}

export interface LeadershipPerson {
  id: string;
  email: string;
  phone: string | null;
  full_name: string | null;
  preferred_name: string | null;
  role: string;
  profile_photo_url?: string | null;
  // True when this person fills the slot via additional ("acting") coverage
  // rather than their primary role (e.g. an RVP covering an area as SDO).
  acting?: boolean;
}

export interface StoreLeadership {
  gm: LeadershipPerson | null;
  do: LeadershipPerson | null;
  sdo: LeadershipPerson | null;
  rvp: LeadershipPerson | null;
}

export interface MyTreeResponse {
  regions: MyRegionNode[];
  leadership: Record<string, StoreLeadership>;
}

export interface BirthdayEntry {
  id: string;
  name: string;
  role: string;
  birthday: string; // ISO YYYY-MM-DD
  store_number: string | null;
  store_name: string | null;
  region_id: string | null;
  region_name: string | null;
  rvp_id: string | null;
  rvp_name: string | null;
}
