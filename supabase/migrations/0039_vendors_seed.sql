-- supabase/migrations/0039_vendors_seed.sql
--
-- Seeds the Work Orders V2 `vendors` table with the franchise's vendor
-- directory (carried over from the prior prototype). Fixes the same
-- "bare ON CONFLICT" pitfall as 0038:
--
--   * Adds a unique constraint on vendors.name so ON CONFLICT has a
--     target and re-runs are no-ops, not duplicates.
--   * Pre-dedupes by name in case the user already ran a version of
--     this seed manually.
--   * Uses ON CONFLICT (name) DO NOTHING so the seed is idempotent.
--
-- If you want a vendor renamed later, do it through the Vendors tab in
-- /admin/work-orders-v2 — the unique constraint just enforces "no two
-- rows with the exact same name."
--
-- Safe to re-run.

-- ── 1) Dedupe any existing duplicates by name ───────────────
delete from vendors a
using vendors b
where a.id > b.id
  and a.name = b.name;

-- ── 2) Unique constraint on name ────────────────────────────
alter table vendors drop constraint if exists vendors_name_unique;
alter table vendors add constraint vendors_name_unique unique (name);

-- ── 3) Seed ─────────────────────────────────────────────────
insert into vendors (name, category, service_area, services, contact_person, email, phone, notes, website, is_active) values
('PETER J LIMSKY','Fryers and Grills','Dallas Area, Fort Worth Area','Fryer, Griddle','Pete','Pjlimsky@gmail.com','(817) 521-1166','Call First for Fryer / Grill','',true),
('Kniatt Mechanical LLC','Fryers and Grills, HVAC, Chiller, Small Equipment','Dallas Area, Fort Worth Area','AP Warmer, Bun Toaster, Chiller (Roof Top), Freezer (Upright), Fry Dump, Fryer, Fryer Vent Hood, Ice Machine (Center), Ice Machine (Left), Ice Machine (Right), Meat Freezer, Refrigerator (Upright), Steamer, Vent Hood, Walk-In Cooler, Walk-In Freezer','Nate','nkniatt@gmail.com','(940) 453-7404','','',true),
('Mr. Tech 24/7','HVAC, Ice Machine, Refrigeration','Dallas Area, Fort Worth Area','Dresser, Dual Door Reach-In, Dual Temp Reach In, Freezer (Upright), Ice Machine (Center), Ice Machine (Left), Ice Machine (Right), Refrigerator (Upright), Shake Machine, Slush Machine, Soft Serve, Walk-In Cooler, Walk-In Freezer','Gill','zubair.gill@live.com','(804) 325-5051','Call first for All Refrigeration and HVAC Issues','',true),
('Gasket Guy of DFW','Gaskets and Welding','Dallas Area, Fort Worth Area','Door – Walk-In Cooler, Door – Walk-In Freezer, Gaskets (General)','','info@gasketguydfw.com','(972) 407-0008','','',true),
('John Dempsey','Handyman','Dallas Area, Fort Worth Area','Combined Handyman','John','constructionspecialists@hotmail.com','(214) 718-3874','','',true),
('Above & Beyond Plumbing Services','Plumbing','Dallas Area, Fort Worth Area','Backflow Repair, Backflow Testing, General Plumbing, Toilet','','ajrheatac@gmail.com','(817) 550-5066','','',true),
('Frostex Refrigeration','Shake and Slush Machines','Dallas Area, Fort Worth Area','Shake Machine, Slush Machine, Soft Serve','','parts@frostexref.com','(877) 276-0622','Call first for Shake / Slush Machine','',true),
('Amazon','Monitors','Dallas Area, Fort Worth Area','Computer Monitor, Dress Station Monitor, Fry/Swamp Monitor, Grill Monitor, Production Projections Monitor','Contact your DO','','','','',true),
('Metropolitan Plumbing','Plumbing','Dallas Area, Fort Worth Area','General Plumbing, Toilet','James','','(323) 445-3370','Call first for all Plumbing','',true),
('Texas Master Locksmith','Locksmith','Dallas Area, Fort Worth Area','Door - Locks','Stephanie Ewen','service@txmlss.com','','','',true),
('Electro Freeze Dist. of TX','Shake and Slush Machines','Dallas Area, Fort Worth Area','Shake Machine, Slush Machine, Soft Serve','Chris','service@electrofreeze.com','','','',true),
('TechChefs','Electrical, POS, Ordermatic, HME','Dallas Area, Fort Worth Area','Lighting (Exterior), Lighting (Interior), Ordermatic, Pylon Sign','Olivia/Ty Thompson','admin@techchefstx.com','','','',true),
('Layne Glass','Doors, Windows','Dallas Area, Fort Worth Area','Door – Back Door, Door – Restroom Door','Michelle Taylor','service@layneglass.com','','Must have a PO Number','',true),
('Master Home Solutions','Concrete, Doors, Handyman','Dallas Area, Fort Worth Area','Combined Handyman','Dennis','','(469) 407-1372','','',true),
('Grease Master','Vent Hood Cleaning','Dallas Area, Fort Worth Area','Vent Hood Cleaning','Donnie','','(254) 522-1937','','',true),
('R F Technologies','POS, HME, Headsets','Dallas Area, Fort Worth Area','Headsets','','CSR@RFTECHNO.COM','(618) 717-7015','','',true),
('AJR Heating Air Conditioning Refrigeration','HVAC, Ice Machine, Refrigeration','Dallas Area, Fort Worth Area','Dresser, Dual Door Reach-In, Freezer (Upright), Ice Machine (Center), Ice Machine (Left), Ice Machine (Right), Refrigerator (Upright), Shake Machine, Slush Machine, Soft Serve, Walk-In Cooler, Walk-In Freezer','','ajrheatac@gmail.com','(817) 550-5066','','',true),
('A & A Active Backflow LLC','Backflow Testing and Repair','Dallas Area, Fort Worth Area','Backflow Repair, Backflow Testing','','service@backflowtx.net','(972) 242-2229','','',true),
('Critter Stop','Pest Control','Dallas Area, Fort Worth Area','Pest Control','','','','','',true),
('Badge Services Co Inc','Badge Services','OKC','Badge services','','','(870) 325-7011','','',true),
('Coke','Beverage','OKC','Beverage delivery','','','(800) 241-2653','','',true),
('NUCO2','CO2 Supply','OKC','CO2 supply','','','(800) 472-2855','','',true),
('SEI (POPS)','POS Systems','OKC','POS systems','','','(888) 251-6716','','',true),
('POS Escalations','POS Support','OKC','POS support','','','(855) 637-6642','','',true),
('Micros Help Desk','POS Support','OKC','POS support','','','(866) 265-1064','','',true),
('RF Technologies','Technology Services','OKC','Technology services','','','(800) 598-2370','','',true),
('Bliss Electric','Electrical','OKC','Electrical repair','','','(405) 793-8208','','',true),
('Fireco','Fire Suppression','OKC','Fire suppression','','','(405) 672-9666','','',true),
('Bimbo - Kyle','Bakery','OKC','Bakery delivery','','','(405) 642-9613','','',true),
('Ben E. Keith - Edmond','Food Distribution','Edmond','Food distribution','','','(405) 753-7600','','',true),
('Allied Glass','Glass Repair','OKC','Glass repair','','','(405) 943-3223','','',true),
('Shawnee Glass','Glass Repair','Shawnee','Glass repair','','','(405) 273-5778','','',true),
('Darlington International Inc','Grease Removal','Nationwide','Grease removal','','','(800) 742-1130','','',true),
('Brooks Grease Service','Grease Removal','Tulsa','Grease removal','','','(918) 836-1772','','',true),
('Capital Processing','Grease Removal','OKC','Grease removal','','','(405) 235-9960','','',true),
('City Grease Trap Service','Grease Trap','OKC','Grease trap service','','','(405) 232-0014','','',true),
('Driploc','Grease Containment','Nationwide','Grease containment','','','(877) 374-7562','','',true),
('Stafford-Smith Inc','Large Equipment','OKC','Large equipment service','Ryan','','(405) 435-2485','','',true),
('B&G Chemical','Pest Control','OKC','Pest control, Fly Traps','','','(405) 848-8858','','',true),
('Mullin Plumbing','Plumbing','OKC','Plumbing','','','(405) 943-0009','','',true),
('Brewer Plumbing','Plumbing','OKC','Plumbing','Shawn','','(405) 221-0893','','',true),
('Brooks Industries','HVAC','OKC','HVAC','','','(405) 685-1200','','',true),
('Expert Repair','HVAC','OKC','HVAC','','','(405) 719-0711','','',true),
('Taylor of OK','HVAC','OKC','HVAC','','','(405) 840-6018','','',true),
('Hagar Restaurant Supply','Smallwares','OKC','Smallwares','','','(405) 235-1723','','',true),
('Alarm Monitoring Co','Alarm','OKC','Alarm monitoring','','','(800) 432-6533','','',true),
('A Better Locksmith - OKC','Locksmith','OKC','Locksmith','','','(405) 348-8688','','',true),
('Shawnee Alarm Services','Alarm','Shawnee','Alarm services','','','(405) 273-7476','','',true),
('Heritage','Smallwares','OKC','Smallwares','','','(405) 228-0707','','',true),
('Heritage Fulfillment - El Reno','Supplies','El Reno','Supplies','','','(800) 888-4356','','',true),
('Dot It Labels','Labels','Nationwide','Labels','','','(800) 642-3687','','',true),
('Kelley Construction','Handyman','OKC','Handyman and General Construction','','','(405) 721-6150','','',true),
('Duro Last Roofing','Roofing','OKC','Roofing','','','(888) 301-7712','','',true),
('Nathan Hodges Alarm','Alarm','OKC','Alarm Company','','','(405) 570-7634','','',true),
('Mike Fleet Clean','Cleaning','OKC','Cleaning','','','(405) 501-2711','','',true),
('Gasket Guy OKC','Gaskets','OKC','Gaskets','','','(405) 519-2711','','',true),
('Salazar Roofing','Roofing','OKC','Roofing','','','(405) 265-4200','','',true),
('Stanfield Plumbing','Plumbing','OKC','Plumbing','','','(405) 617-2838','','',true),
('Troops Refrigeration','Refrigeration','OKC','Refrigeration','','','(405) 787-6677','','',true),
('Vaghn Electrical','Electrical','OKC','Electrical','','','(918) 808-7814','','',true),
('5 Point Henny Penney','Equipment','OKC','Equipment service','','','(817) 422-5860','','',true),
('High Reach Tree Service','Landscaping','Dallas Area, Fort Worth Area','Landscaping, Tree removal','','','','','',true),
('Dream Built','Handyman, Construction','Dallas Area, Fort Worth Area','Combined Handyman, Trash enclosure','','','','','',true),
('American Backflow','Backflow Testing and Repair','Dallas Area, Fort Worth Area','Backflow Testing, Backflow Repair','','','','','',true)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
