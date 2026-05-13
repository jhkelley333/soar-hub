-- supabase/migrations/0040_issue_library_troubleshooting_tips.sql
--
-- Adds an optional troubleshooting_tips column to issue_library so admins
-- can author equipment-specific "things to check first" prompts that the
-- New Service Request modal renders inline when a user picks an issue.
--
-- The column is nullable + plain text (one tip per line — the UI splits
-- on newlines for rendering). Seeds a few common ones so the prompt
-- shows up immediately for the most common equipment categories.
--
-- Idempotent — safe to re-run.

alter table issue_library
  add column if not exists troubleshooting_tips text;

-- ── Seeds (only fill rows that don't already have tips) ──

-- Fryers
update issue_library set troubleshooting_tips = $tips$• Check the breaker — flip it fully off, then back on.
• Confirm the oil level is between the min/max lines.
• Verify the thermostat dial is set correctly and hasn't been bumped.
• Listen for the burners igniting — if no click, the gas valve may be off.
• Photograph the equipment data plate so the vendor can pull the right parts.$tips$
where troubleshooting_tips is null
  and lower(asset_type) like '%fryer%';

-- HVAC
update issue_library set troubleshooting_tips = $tips$• Replace or clean the air filter.
• Check the thermostat batteries and that it's set to "Cool" / "Heat".
• Inspect the breaker — HVAC trips often re-set silently.
• Confirm the outdoor unit isn't iced over or blocked by debris.
• Note any error codes flashing on the thermostat.$tips$
where troubleshooting_tips is null
  and (lower(asset_type) like '%hvac%' or lower(category) = 'hvac');

-- Ice machines / makers
update issue_library set troubleshooting_tips = $tips$• Verify the water supply valve to the machine is fully open.
• Check the water filter — swap if older than 6 months.
• Look at the breaker for the unit.
• Confirm the bin door closes flush so the "bin full" sensor isn't tripped.
• Note any error code or blinking indicator light.$tips$
where troubleshooting_tips is null
  and lower(asset_type) like '%ice%'
  and (lower(asset_type) like '%machine%' or lower(asset_type) like '%maker%');

-- Refrigeration / coolers / freezers
update issue_library set troubleshooting_tips = $tips$• Check the breaker for the unit.
• Verify the thermostat dial / digital setpoint hasn't been changed.
• Look for blocked vents inside (over-packed boxes) and outside (condenser coils).
• Confirm the door gasket seals flush — gaps cause runaway warming.
• Note current temp from the unit display before submitting.$tips$
where troubleshooting_tips is null
  and (lower(category) like '%refriger%'
       or lower(asset_type) like '%walk-in%'
       or lower(asset_type) like '%reach-in%'
       or lower(asset_type) like '%cooler%'
       or lower(asset_type) like '%freezer%');

-- POS / registers / tablets
update issue_library set troubleshooting_tips = $tips$• Power cycle the device — full off for 30 seconds, then back on.
• Confirm network cables are seated and the router has internet (try another device).
• Check that no error toast/banner is showing on the device.
• Note the exact error message or screen.$tips$
where troubleshooting_tips is null
  and (lower(category) like '%pos%'
       or lower(asset_type) like '%pos%'
       or lower(asset_type) like '%register%'
       or lower(asset_type) like '%kiosk%'
       or lower(asset_type) like '%tablet%');

-- Frozen drink / slush / BIB / CO2
update issue_library set troubleshooting_tips = $tips$• Check the breaker.
• Verify the CO2 / syrup BIB is not empty.
• Inspect lines for kinks or disconnections.
• Note any leaking around fittings.$tips$
where troubleshooting_tips is null
  and (lower(asset_type) like '%frozen drink%'
       or lower(asset_type) like '%slush%'
       or lower(asset_type) like '%bib%'
       or lower(asset_type) like '%co2%');

notify pgrst, 'reload schema';
