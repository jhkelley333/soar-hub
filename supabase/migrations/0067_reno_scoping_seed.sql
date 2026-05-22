-- supabase/migrations/0067_reno_scoping_seed.sql
--
-- Seeds the "Sonic Reskin Full to Bright 2026" template:
--   * 27 checklist items split 8 / 10 / 8 / 1 across the four tiers.
--   * 18 photo slots (10 required named + 8 generic overflow).
--
-- Source: 2026 Inspire Reskin Playbook (page 34 closeout doc) cross-
-- referenced with the 2025 Completion Checklist. Per-item descriptions
-- include playbook page citations where the original draft had them.
--
-- Item #260 "Install Lenticulars" is the only item that needs a
-- per-building-type required override (shown for all building types,
-- required for everything except brick_stone) — it has its own insert
-- block to keep the bulk inserts compact.
--
-- A DO $$ ... ASSERT $$ block at the bottom fails the migration if the
-- tier counts drift from 8/10/8/1.

-- ----------------------------------------------------------------------------
-- 1. Template row (fixed uuid so seed re-runs / rollbacks target it cleanly).
-- ----------------------------------------------------------------------------

insert into scope_templates (id, name, module_type, version, is_active)
values (
  '11111111-1111-1111-1111-111111111111',
  'Sonic Reskin Full to Bright 2026',
  'reno_scoping',
  '2026.1',
  true
)
on conflict (module_type, version) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Photo slots — 10 required + 8 generic overflow.
-- ----------------------------------------------------------------------------

insert into scope_photo_slots
  (template_id, slot_number, slot_name, is_required, is_conditional, sort_order)
values
  ('11111111-1111-1111-1111-111111111111',  1, 'Front Elevation',                       true,  false, 10),
  ('11111111-1111-1111-1111-111111111111',  2, 'Side Elevation (Drive-Thru side)',      true,  false, 20),
  ('11111111-1111-1111-1111-111111111111',  3, 'Rear Elevation',                        true,  false, 30),
  ('11111111-1111-1111-1111-111111111111',  4, 'Side Elevation (Non Drive-Thru side)',  true,  false, 40),
  ('11111111-1111-1111-1111-111111111111',  5, 'Ground Sign',                           true,  false, 50),
  ('11111111-1111-1111-1111-111111111111',  6, 'Cherry Sign',                           true,  false, 60),
  ('11111111-1111-1111-1111-111111111111',  7, 'Directional Sign',                      true,  false, 70),
  ('11111111-1111-1111-1111-111111111111',  8, 'Pylon Sign',                            true,  false, 80),
  ('11111111-1111-1111-1111-111111111111',  9, 'Trash Cans',                            true,  false, 90),
  ('11111111-1111-1111-1111-111111111111', 10, 'Tables / Patio Furniture',              true,  false, 100),
  ('11111111-1111-1111-1111-111111111111', 11, '+Up or Existing Conditions Repair (1)', false, true,  110),
  ('11111111-1111-1111-1111-111111111111', 12, '+Up or Existing Conditions Repair (2)', false, true,  120),
  ('11111111-1111-1111-1111-111111111111', 13, '+Up or Existing Conditions Repair (3)', false, true,  130),
  ('11111111-1111-1111-1111-111111111111', 14, '+Up or Existing Conditions Repair (4)', false, true,  140),
  ('11111111-1111-1111-1111-111111111111', 15, '+Up or Existing Conditions Repair (5)', false, true,  150),
  ('11111111-1111-1111-1111-111111111111', 16, '+Up or Existing Conditions Repair (6)', false, true,  160),
  ('11111111-1111-1111-1111-111111111111', 17, '+Up or Existing Conditions Repair (7)', false, true,  170),
  ('11111111-1111-1111-1111-111111111111', 18, '+Up or Existing Conditions Repair (8)', false, true,  180)
on conflict (template_id, slot_number) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Existing Conditions (8 items, sort 110-180)
-- ----------------------------------------------------------------------------

insert into scope_template_items
  (template_id, category, subcategory, sort_order, item_label, item_description, tier, photo_required)
values
  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 110,
   'Parking lot in good repair with visible striping',
   'Check pavement condition, cracks, potholes, faded striping. Restripe is part of Minimum Standard scope, but pre-reskin the lot must be in repairable shape.',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 120,
   'Patio and sidewalk concrete clean',
   'Power washing happens during reskin. Pre-scope check is for structural integrity — cracks, settlement, ADA compliance.',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 130,
   'Landscaping healthy, especially around patio, DT menu and street',
   'Trees pruned away from signage sight lines. Beds defined. Dead plants flagged for replacement.',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 140,
   'Lighting working on both canopies and building',
   'All existing fixtures functional. Note any non-working lights — reskin replaces with LED but existing wiring must be sound.',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 150,
   'Patio and stall canopy clean and free of rust',
   'Per Playbook page 19, extensive rust requires additional chemicals/sanding and photo proof. Flag rust areas in notes with photos.',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Interior', 'Existing Conditions', 160,
   'Restrooms have tile and are in good repair',
   'Only interior check in pre-scope. Confirm tile, plumbing functional, no major damage.',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 170,
   'POPS all working (can consider some reductions)',
   'All Point-of-Sale stalls functional. Note any non-working units. POPS optimization is a separate optional scope (deferred from this module).',
   'existing_condition', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Existing Conditions', 180,
   'DT menu in good shape with confirmation board',
   'New DT menu boards are NOT repainted (per Playbook page 17). Confirm existing board condition. Old yellow menu boards will be painted red as part of Minimum Standard.',
   'existing_condition', false);

-- ----------------------------------------------------------------------------
-- 4. Minimum Standard (10 items, sort 210-300)
--    Item #260 (Lenticulars) is pulled into its own insert because it needs
--    required_for_building_types to exclude brick_stone.
-- ----------------------------------------------------------------------------

insert into scope_template_items
  (template_id, category, subcategory, sort_order, item_label, item_description, tier, photo_required)
values
  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 210,
   'Complete Demolition of Old Branding and Signs',
   'Remove existing building signs, wall packs, cherry limeade poster, Always Fresh / Full Menu All Day cabinet signs, acorn pendant lights, existing patio furniture and trashcans, existing LED lighting. Remove stall canopy if applicable.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 220,
   'Prep and paint all exterior steel — green/yellow replaced',
   'Includes domes, railings, dumpsters, bollards, roof ladders, utilities, guardrails. SW Cityscape (SW7067) for poles/trims/doors. SW Cherry Red (SW4081) for OA stall poles and bollards.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 230,
   'Clean and paint stucco / EIFS / wainscot as applicable',
   'Use Loxon Concrete & Masonry Primer (LX02) + Loxon Self-Cleaning Acrylic Coating Satin (LX14). Sonic Sky Blue (SL2502) for facades / parapet cap / center tower / DT tower.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 240,
   'Replace Nichiha as needed and repaint all Nichiha',
   'Pre-scope: identify damaged / missing Nichiha panels for replacement. All Nichiha is repainted per spec.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Signage', 'Minimum Standard', 250,
   'Install new replacement signage including driveway directional signs',
   'Full sign package required: Delta sign on doghouse/building, LED Cherry sign(s) (3'' on facade or 2'' on barrel canopy), Channel Letters if approved, new directional signs (Enter / Exit / Drive Thru). Pylon/monument signs refaced or replaced.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 270,
   'Install Expression Panels (Heat-applied 3M Vinyl or ACM)',
   'Options: Area Code Trays, Red Emoji Trays, Made-To-Order Delta Cup or GPS graphics. Localization required — coordinate with Brand for approval prior to fabrication.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 280,
   'Install Red ACM fascia with White Cove GM LED Tape lighting',
   'Includes doghouse ribkit, curved barrel patio fascia, drive-thru canopy fascia. LED tape under Patio Barrel Canopy replaces acorn pendant lighting.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 290,
   'Install new tables and trash receptacles',
   'Brand-approved: Plantation Prestige picnic tables (birchwood slats / white frame). MaxR trashcans (birchwood slats with gray top). Minimum 1 ADA table required.',
   'minimum_standard', true),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 300,
   'Remove and Replace Window Decals / Film',
   'White Stripe Transparent Gradient (default) or Blue Stripe (brick buildings only, with Brand approval). Plus patio poster if existing. From S&S Promotions.',
   'minimum_standard', true);

-- Item #260 — Lenticulars: shows for all building types, required for
-- everything except brick_stone (badge-only there).
insert into scope_template_items
  (template_id, category, subcategory, sort_order, item_label, item_description, tier, photo_required,
   applies_to_building_types, required_for_building_types)
values
  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Minimum Standard', 260,
   'Install Lenticulars and eyebrow with GM LED Tape',
   'Optional for brick / stone buildings. For brick/stone, exterior graphics are recommended at a minimum instead (post-construction verification, not part of pre-scope).',
   'minimum_standard', true,
   array['center_tower_curved','dt_tower_curved','center_tower_flat','brick_stone']::building_type[],
   array['center_tower_curved','dt_tower_curved','center_tower_flat']::building_type[]);

-- ----------------------------------------------------------------------------
-- 5. Plus-Ups (8 items, sort 310-380)
-- ----------------------------------------------------------------------------

insert into scope_template_items
  (template_id, category, subcategory, sort_order, item_label, item_description, tier, photo_required)
values
  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 310,
   'Silver standing seam replacing fabric',
   'Replaces fabric canopy with silver standing seam metal roof system.',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 320,
   'Flat canopy replacing curved fabric with new deck plan and gutter',
   'Structural change from curved barrel canopy to flat canopy. Includes new deck plan and gutter system.',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 330,
   'String lighting to replace acorn lighting at patio',
   'Alternative to LED tape under barrel canopy. Decorative string lighting for patio area.',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 340,
   'Full lenticulars wrap',
   'Extended lenticulars coverage beyond minimum scope.',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 350,
   'Raise parapet, add Knotwood / Nichiha Spruce',
   'Structural parapet height increase with new finish material (Knotwood or Nichiha Spruce).',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 360,
   'New replacement doghouse at center or DT with LED',
   'Full doghouse replacement (vs. repair + repaint per Minimum Standard). Anodized aluminum with LED. Doghouse is a Brand Element — cannot be removed.',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 370,
   'Steel and powder coat faux wood railings',
   'Upgrade from standard guardrails to steel powder-coated faux wood finish.',
   'plus_up', false),

  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Plus-Up', 380,
   'Refurbish landscape',
   'Beyond Existing Conditions baseline — new beds, plant material, mulch, edging.',
   'plus_up', false);

-- ----------------------------------------------------------------------------
-- 6. Optional (1 item, sort 410)
-- ----------------------------------------------------------------------------

insert into scope_template_items
  (template_id, category, subcategory, sort_order, item_label, item_description, tier, photo_required,
   applies_to_building_types)
values
  ('11111111-1111-1111-1111-111111111111', 'Exterior', 'Optional', 410,
   'Paint brick and stone',
   'Truly optional. Only applies to brick / stone buildings. Per Playbook, brick/stone buildings may keep natural finish; painting is a take-it-or-leave-it choice.',
   'optional', false,
   array['brick_stone']::building_type[]);

-- ----------------------------------------------------------------------------
-- 7. Sanity check — fail the migration if counts drift from 8/10/8/1.
-- ----------------------------------------------------------------------------

do $$
declare
  c_existing  int;
  c_minimum   int;
  c_plus_up   int;
  c_optional  int;
  c_total     int;
  c_slots     int;
begin
  select count(*) into c_existing  from scope_template_items
    where template_id = '11111111-1111-1111-1111-111111111111' and tier = 'existing_condition';
  select count(*) into c_minimum   from scope_template_items
    where template_id = '11111111-1111-1111-1111-111111111111' and tier = 'minimum_standard';
  select count(*) into c_plus_up   from scope_template_items
    where template_id = '11111111-1111-1111-1111-111111111111' and tier = 'plus_up';
  select count(*) into c_optional  from scope_template_items
    where template_id = '11111111-1111-1111-1111-111111111111' and tier = 'optional';
  select count(*) into c_total     from scope_template_items
    where template_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into c_slots     from scope_photo_slots
    where template_id = '11111111-1111-1111-1111-111111111111';

  assert c_existing = 8,  format('Expected 8 existing_condition items, got %s',  c_existing);
  assert c_minimum  = 10, format('Expected 10 minimum_standard items, got %s',  c_minimum);
  assert c_plus_up  = 8,  format('Expected 8 plus_up items, got %s',             c_plus_up);
  assert c_optional = 1,  format('Expected 1 optional item, got %s',             c_optional);
  assert c_total    = 27, format('Expected 27 total items, got %s',              c_total);
  assert c_slots    = 18, format('Expected 18 photo slots, got %s',              c_slots);
end $$;
