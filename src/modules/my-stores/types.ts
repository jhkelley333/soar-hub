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

export interface MyStoreNode {
  id: string;
  number: string;
  name: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  address: string | null;
  district_id: string | null;
  is_active: boolean;
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
}

export interface StoreLeadership {
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
