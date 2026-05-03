-- supabase/migrations/0010_real_org_seed.sql
--
-- Phase 2c: replace the placeholder seed (Dallas/Houston test data) with
-- the real R4 / West South Central footprint.
--
-- WHAT THIS MIGRATION DOES (destructive — read carefully):
--   1. TRUNCATE user_scopes  — every existing scope assignment is wiped.
--      Re-assign your real users via the My Team UI after this runs.
--   2. DELETE FROM stores → districts → areas → regions in order.
--      profiles.primary_store_id is auto-nulled by ON DELETE SET NULL.
--      profiles themselves are untouched (no profile data is lost).
--   3. INSERT R4 + 3 areas + 12 districts + 84 stores.
--
-- COVERAGE: One region (R4 / West South Central) for now. Areas:
--   Area 07 OKC          — 2 districts, 12 stores
--   Area 08 North DFW    — 5 districts, 36 stores
--   Area 09 South DFW    — 5 districts, 36 stores
--
-- Other regions (R1–R3, R5+) can be appended via a follow-on migration
-- without re-running this one.
--
-- NOTES:
--   - Phone is normalized to 10 digits to satisfy stores_phone_format_ck.
--   - ZIP+4 ("73110-4430") is preserved as-is — schema is text.
--   - Identity is by code (regions/areas/districts) and number (stores).
--     UUIDs are generated fresh; references resolved by code joins so
--     the file stays human-readable.
--   - Idempotent: re-running wipes and re-inserts (UUIDs will churn).
--
-- ONE STORE SKIPPED: the last row of the source CSV was truncated mid-paste
-- and is intentionally omitted. Add it via the admin UI once available.

begin;

-- 1. Wipe assignments
truncate user_scopes;

-- 2. Wipe org tree (order matters: stores RESTRICT-references districts)
delete from stores;
delete from districts;
delete from areas;
delete from regions;

-- 3. Region
insert into regions (code, name, is_active) values
  ('R4', 'West South Central', true);

-- 4. Areas
insert into areas (code, name, region_id, is_active)
select v.code, v.name, r.id, true
from (values
  ('Area 07', 'OKC',       'R4'),
  ('Area 08', 'North DFW', 'R4'),
  ('Area 09', 'South DFW', 'R4')
) as v(code, name, region_code)
join regions r on r.code = v.region_code;

-- 5. Districts
insert into districts (code, name, area_id, is_active)
select v.code, v.name, a.id, true
from (values
  ('D101', 'OKC 1',  'Area 07'),
  ('D102', 'OKC 2',  'Area 07'),
  ('D103', 'DFW 1',  'Area 08'),
  ('D104', 'DFW 2',  'Area 08'),
  ('D105', 'DFW 3',  'Area 09'),
  ('D106', 'DFW 4',  'Area 09'),
  ('D107', 'DFW 5',  'Area 09'),
  ('D108', 'DFW 6',  'Area 09'),
  ('D109', 'DFW 7',  'Area 09'),
  ('D110', 'DFW 8',  'Area 08'),
  ('D111', 'DFW 9',  'Area 08'),
  ('D112', 'DFW 10', 'Area 08')
) as v(code, name, area_code)
join areas a on a.code = v.area_code;

-- 6. Stores
insert into stores (number, name, district_id, phone, address, city, state, zip, is_active)
select v.number, v.name, d.id, v.phone, v.address, v.city, v.state, v.zip, true
from (values
  -- D101 OKC 1
  ('1945', 'El Reno OK',                    'D101', '4052623171', '1120 W. Sunset Dr.',          'El Reno',     'OK', '73036-2343'),
  ('2167', 'Harrah OK',                     'D101', '4054546200', '20190 N. E. 23rd St.',        'Harrah',      'OK', '73045-9115'),
  ('3936', 'Harrah OK',                     'D101', '4053917100', '3140 S. Harrah',              'Harrah',      'OK', '73045-6063'),
  ('5082', 'Norman OK',                     'D101', '4055791300', '4344 Sonic Dr.',              'Norman',      'OK', '73072-9004'),
  ('5116', 'Choctaw OK',                    'D101', '4053863694', '7500 S Choctaw Rd',           'Choctaw',     'OK', '73020-4571'),
  ('5323', 'Shawnee OK (Harrison 2)',       'D101', '4052737277', '4439 N. Harrison St',         'Shawnee',     'OK', '74804-1406'),

  -- D102 OKC 2
  ('2465', 'Midwest City OK',               'D102', '4057330161', '217 S. Air Depot',            'Midwest City','OK', '73110-4430'),
  ('2528', 'Mannford OK',                   'D102', '9188653305', '100 W. Trower',               'Mannford',    'OK', '74044-3155'),
  ('2848', 'Shawnee OK (Harrison 1)',       'D102', '4052753495', '450 N. Harrison Ave.',        'Shawnee',     'OK', '74801-7233'),
  ('2939', 'Shawnee OK (Kickapoo 1)',       'D102', '4052731230', '2131 N. Kickapoo',            'Shawnee',     'OK', '74804-2732'),
  ('4115', 'Shawnee OK (Kickapoo 2)',       'D102', '4052731177', '4625 N. Kickapoo',            'Shawnee',     'OK', '74804-1200'),
  ('6599', 'Neodesha KS',                   'D102', '6203255508', '1317 West Main Street',       'Neodesha',    'KS', '66757'),

  -- D103 DFW 1
  ('4843', 'Frisco TX #1 (Main)',           'D103', '9723779795', '315 Main St',                 'Frisco',      'TX', '75036'),
  ('5163', 'McKinney TX #1 (N Custer)',     'D103', '4699525111', '420 N Custer Rd',             'Mckinney',    'TX', '75071'),
  ('5483', 'Frisco TX #2 (Lebanon)',        'D103', '4693622980', '5353 Lebanon Rd',             'Frisco',      'TX', '75034'),
  ('5501', 'Frisco TX #3 (Warren)',         'D103', '2148723344', '9265 Warren Pkwy',            'Frisco',      'TX', '75035'),
  ('5533', 'McKinney TX #2 (Eldorado)',     'D103', '4699526676', '6481 Eldorado Pkwy',          'Mckinney',    'TX', '75070'),
  ('5752', 'Allen TX #2 (Bethany)',         'D103', '2143830612', '1805 E Bethany Rd',           'Allen',       'TX', '75002'),
  ('6254', 'McKinney TX #3 (S Custer)',     'D103', '9404649414', '7221 S Custer Rd',            'Mckinney',    'TX', '75070'),

  -- D104 DFW 2
  ('3653', 'Rowlett TX',                    'D104', '9724758395', '6601 Dalrock Rd',             'Rowlett',     'TX', '75089'),
  ('3688', 'Garland TX #1 (Jupiter)',       'D104', '9724964356', '6130 N Jupiter Rd',           'Garland',     'TX', '75044'),
  ('3781', 'Sachse TX',                     'D104', '9724957598', '6040 S Highway 78',           'Sachse',      'TX', '75048'),
  ('3834', 'McKinney TX #4 (El Dorado)',    'D104', '9725425708', '2950 El Dorado Parkway',      'McKinney',    'TX', '75070'),
  ('4059', 'Frisco TX #4 (Preston)',        'D104', '4696330046', '7630 Preston Road',           'Frisco',      'TX', '75034'),
  ('4638', 'Murphy TX',                     'D104', '9726330770', '109 W. FM 544',               'Murphy',      'TX', '75094'),
  ('4649', 'Princeton TX',                  'D104', '9727363843', '401 E Princeton Drive',       'Princeton',   'TX', '75407'),
  ('6560', 'Frisco TX #5 (Frisco)',         'D104', '4693626595', '11665 Frisco Street',         'Frisco',      'TX', '75033'),

  -- D105 DFW 3
  ('3441', 'Dallas TX #3 (NW Hwy)',         'D105', '2143495475', '11921 East NW Highway',       'Dallas',      'TX', '75238'),
  ('3512', 'Dallas TX #6 (Garland)',        'D105', '2143214333', '9119 Garland Road',           'Dallas',      'TX', '75218'),
  ('3557', 'Wills Point TX',                'D105', '9038732773', '907 West South Commerce',     'Wills Point', 'TX', '75169'),
  ('3617', 'Dallas TX #7 (Plano)',          'D105', '2143425393', '9609 Plano Rd',               'Dallas',      'TX', '75238'),
  ('4398', 'Dallas TX #9 (Audelia)',        'D105', '2143497035', '10709 Audelia Road',          'Dallas',      'TX', '75238'),
  ('4688', 'Garland TX #2 (Broadway)',      'D105', '9722032993', '6202 Broadway Blvd.',         'Garland',     'TX', '75043'),
  ('5367', 'Garland TX #3 (Hwy 66)',        'D105', '9722050378', '2001 State Hwy 66',           'Garland',     'TX', '75040'),
  ('5486', 'Malakoff TX',                   'D105', '9034890591', '418 West Royall Boulevard',   'Malakoff',    'TX', '75148'),

  -- D106 DFW 4
  ('1056', 'Dallas TX #1 (Ft Worth)',       'D106', '2149462080', '2516 Fort Worth Avenue',      'Dallas',      'TX', '75211'),
  ('1057', 'Dallas TX #2 (Ledbetter)',      'D106', '2144674677', '2429 W Ledbetter Drive',      'Dallas',      'TX', '75233'),
  ('3444', 'Dallas TX #4 (Inwood 1)',       'D106', '2143504077', '3023 Inwood Road',            'Dallas',      'TX', '75235'),
  ('3445', 'Dallas TX #5 (Greenville)',     'D106', '2147394677', '7071 Greenville Avenue',      'Dallas',      'TX', '75231'),
  ('4265', 'Arlington #1 (Green Oaks)',     'D106', '8172749028', '1100 NE Green Oaks Blvd',     'Arlington',   'TX', '76006'),
  ('4387', 'Grand Prairie TX',              'D106', '9726230600', '2991 S. State Highway 360',   'Grand Prairie','TX','75052'),
  ('4418', 'Dallas TX #10 (Forest)',        'D106', '9726448220', '8045 Forest Lane',            'Dallas',      'TX', '75243'),
  ('4632', 'Arlington #2 (Lamar)',          'D106', '8174602960', '2121 E Lamar Blvd',           'Arlington',   'TX', '76006'),

  -- D107 DFW 5
  ('3672', 'Dallas TX #8 (Inwood 2)',       'D107', '9729804262', '12130 Inwood Rd',             'Dallas',      'TX', '75244'),
  ('3906', 'Hurst TX',                      'D107', '8172824222', '1308 Precinct Line Road',     'Hurst',       'TX', '76053'),
  ('4160', 'N Richland Hills TX',           'D107', '8172842000', '7608 Blvd 26',                'North Richland Hills','TX','76180'),
  ('4859', 'Keller TX #2 (Golden)',         'D107', '8173374070', '4500 Golden Triangle Blvd',   'Keller',      'TX', '76244'),
  ('5632', 'Dallas TX #11 (Monfront)',      'D107', '9722390441', '15205 Monfront Drive',        'Dallas',      'TX', '75248'),
  ('5691', 'Irving TX #1 (JC)',             'D107', '9725500395', '900 W. John Carpenter Frwy',  'Irving',      'TX', '75039'),
  ('5780', 'Irving TX #2 (Walnut)',         'D107', '9722527108', '3431 West Walnut Hill',       'Irving',      'TX', '75038'),

  -- D108 DFW 6
  ('4541', 'Fort Worth TX #1 (Clifford)',   'D108', '8172460922', '9560 Clifford Street',        'Fort Worth',  'TX', '76108'),
  ('5105', 'Fort Worth TX #2 (Basswood)',   'D108', '8178476656', '3078 Basswood Blvd.',         'Fort Worth',  'TX', '76137'),
  ('5353', 'Fort Worth TX #3 (Boat Club)',  'D108', '8172361247', '7101 Boat Club Road',         'Fort Worth',  'TX', '76179'),
  ('5392', 'Keller TX #3 (Beach)',          'D108', '8174316591', '8661 N Beach Street',         'Keller',      'TX', '76244'),
  ('5529', 'Westworth Village TX',          'D108', '8177325268', '6640 Westworth Blvd',         'Westworth Village','TX','76114'),
  ('6449', 'Haslet TX',                     'D108', '8174398589', '470 156 South',               'Haslet',      'TX', '76052'),
  ('6571', 'Fort Worth TX #4 (Ridge)',      'D108', '8178478990', '9628 Tehama Ridge Parkway',   'Fort Worth',  'TX', '76177'),

  -- D109 DFW 7
  ('1082', 'Granbury TX',                   'D109', '8175734401', '1155 W US Hwy 377 East',      'Granbury',    'TX', '76048'),
  ('1706', 'Bedford TX',                    'D109', '8172837479', '2000 N Central Dr',           'Bedford',     'TX', '76021'),
  ('3263', 'Lake Worth TX',                 'D109', '8172375757', '6327 Lake Worth Blvd',        'Lake Worth',  'TX', '76135'),
  ('3463', 'Haltom City TX',                'D109', '8172817198', '6280 N Beach St',             'Haltom City', 'TX', '76137'),
  ('3825', 'Grapevine TX',                  'D109', '8174421464', '2240 Hall-Johnson Rd',        'Grapevine',   'TX', '76051'),
  ('4248', 'Keller TX #1 (Main)',           'D109', '8177416878', '2009 S Main St',              'Keller',      'TX', '76248'),

  -- D110 DFW 8
  ('1167', 'Lewisville TX #1',              'D110', '9724200544', '175 N Valley Pkwy',           'Lewisville',  'TX', '75067'),
  ('3461', 'Carrollton TX #1 (Frankford)',  'D110', '9722423104', '1021 W Frankford Rd',         'Carrollton',  'TX', '75007'),
  ('3638', 'The Colony TX',                 'D110', '9723700721', '3750 Main St',                'The Colony',  'TX', '75056'),
  ('3687', 'Lewisville TX #2',              'D110', '9723150459', '380 E Round Grove Rd',        'Lewisville',  'TX', '75067'),
  ('4187', 'Plano TX #6 (Midway)',          'D110', '9727811340', '2204 Midway Rd',              'Plano',       'TX', '75093'),
  ('4243', 'Carrollton TX #2 (Hebron)',     'D110', '9723943466', '1412 W Hebron Pkwy',          'Carrollton',  'TX', '75010'),
  ('4729', 'Plano TX #7 (Mapleshade)',      'D110', '9725190332', '4025 Mapleshade Ln',          'Plano',       'TX', '75075'),

  -- D111 DFW 9
  ('1240', 'Plano TX #1 (Jupiter)',         'D111', '9728817414', '721 Jupiter Rd',              'Plano',       'TX', '75074'),
  ('1242', 'Plano TX #2 (Custer)',          'D111', '9725967616', '1601 Custer Rd',              'Plano',       'TX', '75075'),
  ('1722', 'Commerce TX',                   'D111', '9038867166', '1617 State Hwy 50',           'Commerce',    'TX', '75428'),
  ('3367', 'Plano TX #3 (Chase Oaks)',      'D111', '9725279271', '6104 Chase Oaks Blvd',        'Plano',       'TX', '75023'),
  ('3701', 'Plano TX #4 (Coit 1)',          'D111', '9729640226', '3404 Coit Rd',                'Plano',       'TX', '75023'),
  ('3954', 'Plano TX #5 (Coit 2)',          'D111', '9724912191', '7925 Coit Rd',                'Plano',       'TX', '75024'),
  ('4134', 'Allen TX #1 (McDermott)',       'D111', '2145470144', '1310 W McDermott',            'Allen',       'TX', '75013'),

  -- D112 DFW 10
  ('3462', 'Flower Mound TX #1 (Crosstimbers)','D112','4694965665','2925 Crosstimbers',          'Flower Mound','TX', '75022'),
  ('3754', 'Flower Mound TX #2 (Flower Mound)','D112','4694965120','2541 Flower Mound Rd',       'Flower Mound','TX', '75028'),
  ('3967', 'Flower Mound TX #3 (Morriss)',  'D112', '4694449679', '6210 Morriss Rd',             'Flower Mound','TX', '75028'),
  ('4209', 'Southlake TX',                  'D112', '8173375008', '180 Davis Blvd',              'Southlake',   'TX', '76092'),
  ('4790', 'Hickory Creek TX',              'D112', '9404980140', '4150 Teasley Dr',             'Hickory Creek','TX','75056'),
  ('5169', 'Roanoke TX',                    'D112', '8174914848', '1202 N Hwy 377',              'Roanoke',     'TX', '76262'),
  ('5790', 'Lantana TX',                    'D112', '9404649414', '7060 Justin Rd',              'Lantana',     'TX', '76226')
) as v(number, name, district_code, phone, address, city, state, zip)
join districts d on d.code = v.district_code;

commit;
