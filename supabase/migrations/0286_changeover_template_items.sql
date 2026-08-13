-- 0286_changeover_template_items.sql
-- Make the changeover checklist items admin-editable: move the DO + GM lists
-- into a table (seeded from the app defaults). The app renders active items
-- grouped by section (section_order, then sort_order); admins add/edit/reorder/
-- remove them. Checklist instances still key their progress by item_key, so an
-- edit or delete never disturbs an in-progress checklist's checked state.

create table if not exists changeover_template_items (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('do', 'gm')),
  section        text not null,
  section_order  int  not null default 0,
  sort_order     int  not null default 0,
  item_key       text not null unique,
  label          text not null,
  hint           text,
  is_active      boolean not null default true,
  updated_at     timestamptz not null default now()
);

create index if not exists changeover_tpl_kind_idx on changeover_template_items (kind, section_order, sort_order);

alter table changeover_template_items enable row level security;

insert into changeover_template_items (kind, section, section_order, sort_order, item_key, label, hint) values
  ('do', 'Remove System Access', 0, 0, 'do_ra_soar_email', 'SOAR Email (Notify Back Office)', null),
  ('do', 'Remove System Access', 0, 1, 'do_ra_qsr_online', 'QSR Online (SDO — send in a support ticket)', null),
  ('do', 'Remove System Access', 0, 2, 'do_ra_talent_reef', 'Talent Reef (SDO)', null),
  ('do', 'Remove System Access', 0, 3, 'do_ra_micros_infor', 'Delete Micros / Infor access', 'Micros: remove the POS password before deactivating the account. Infor: don''t terminate until after Payroll.'),
  ('do', 'Remove System Access', 0, 4, 'do_ra_iacm', 'IACM Access (SDO)', null),
  ('do', 'Remove System Access', 0, 5, 'do_ra_partnernet', 'Partnernet (SDO — Solugenix ticket)', null),
  ('do', 'Remove System Access', 0, 6, 'do_ra_whatcookin', 'Remove from WhatCookin'' (Partnernet Communications page)', null),
  ('do', 'Remove System Access', 0, 7, 'do_ra_totzone', 'TOTZONE (SDO — Solugenix ticket)', null),
  ('do', 'Remove System Access', 0, 8, 'do_ra_whatsapp', 'Remove from WhatsApp / Crew App', null),
  ('do', 'Remove System Access', 0, 9, 'do_ra_inv_xpress', 'Inventory Xpress (SDO — support ticket)', null),
  ('do', 'Remove System Access', 0, 10, 'do_ra_sync_reports', 'Sync Reports / VOC / Mystery Shops', 'Email: marika.chambers@inspirebrands.com'),
  ('do', 'Remove System Access', 0, 11, 'do_ra_alarm', 'Alarm System access and call list', null),
  ('do', 'Remove System Access', 0, 12, 'do_ra_bank_drops', 'Bank Drops', null),
  ('do', 'Remove System Access', 0, 13, 'do_ra_web_safes', 'Web-Based Safes', null),
  ('do', 'Remove System Access', 0, 14, 'do_ra_icm_dd_ue', 'ItsACheckmate, DoorDash & Uber Eats portal access', null),
  ('do', 'Remove System Access', 0, 15, 'do_ra_barco_vendor', 'Barco & food vendor online access', null),
  ('do', 'Remove System Access', 0, 16, 'do_ra_cameras', 'Security cameras remote access', 'If Zosi, contact Adam.'),
  ('do', 'Remove System Access', 0, 17, 'do_ra_rap', 'RAP Access (Notify Adam)', null),
  ('do', 'Remove System Access', 0, 18, 'do_ra_email_groups', 'SOAR email groups (Notify Adam)', null),
  ('do', 'Remove System Access', 0, 19, 'do_ra_tr_8100', 'Move new DO in TR to 8100 (Notify Adam)', null),
  ('do', 'Remove System Access', 0, 20, 'do_ra_amazon', 'Remove from Amazon Business (Notify Adam)', null),
  ('do', 'Misc', 1, 0, 'do_m_rekey', 'Rekey doors if necessary', null),
  ('do', 'Misc', 1, 1, 'do_m_deposits', 'Verify all store deposits are at the bank', null),
  ('do', 'Misc', 1, 2, 'do_m_petty_cash', 'Verify all stores'' petty cash / cash drawer / changer amounts', null),
  ('do', 'Misc', 1, 3, 'do_m_terminate_tr', 'Terminate in Talent Reef', null),
  ('do', 'Misc', 1, 4, 'do_m_payroll', 'Send payroll changes to SDO, SOAR Payroll, and Back Office', null),
  ('do', 'Misc', 1, 5, 'do_m_hierarchy', 'Update hierarchy list on all platforms (Notify Alex)', null),
  ('do', 'Misc', 1, 6, 'do_m_micros_stores', 'Update stores in Micros — email EM@sonicdrivein.com', '"Remove (Former DO name) access and move stores to (New DO)."'),
  ('do', 'Misc', 1, 7, 'do_m_infor_stores', 'Update stores in Infor User Maintenance for Infor POS', null),
  ('do', 'Misc', 1, 8, 'do_m_tr_username', 'Create a DO username in Talent Reef', null),
  ('do', 'Misc', 1, 9, 'do_m_qsr_username', 'Create a DO username in QSR Online', null),
  ('do', 'Misc', 1, 10, 'do_m_recover', 'Recover SOAR property / equipment / keys', null),
  ('do', 'Misc', 1, 11, 'do_m_notify_gms', 'Notify General Managers', null),
  ('gm', 'Security', 0, 0, 'gm_s_partnernet_pw', 'First — change the Partnernet password', null),
  ('gm', 'Security', 0, 1, 'gm_s_qsr_pw', 'Change password for QSR Online', null),
  ('gm', 'Security', 0, 2, 'gm_s_tr_pw', 'Change password for Talent Reef', null),
  ('gm', 'Security', 0, 3, 'gm_s_micros_infor', 'Delete Micros / Infor access', 'Micros: remove the POS password before deactivating the account. Infor: don''t terminate until after Payroll.'),
  ('gm', 'Security', 0, 4, 'gm_s_whatsapp', 'Remove from WhatsApp / Crew App', null),
  ('gm', 'Security', 0, 5, 'gm_s_totzone', 'Remove from TOTZONE', null),
  ('gm', 'Security', 0, 6, 'gm_s_alarm', 'Remove from alarm system and call list', null),
  ('gm', 'Security', 0, 7, 'gm_s_bank_drop', 'Remove from Bank Drop', null),
  ('gm', 'Security', 0, 8, 'gm_s_cameras', 'Remove security camera access', null),
  ('gm', 'Security', 0, 9, 'gm_s_rekey', 'Rekey doors if necessary', null),
  ('gm', 'Systems', 1, 0, 'gm_sy_deposits', 'Verify deposits are at the bank', null),
  ('gm', 'Systems', 1, 1, 'gm_sy_petty_cash', 'Verify petty cash / cash drawer / changer amounts', null),
  ('gm', 'Systems', 1, 2, 'gm_sy_inventory', 'Verify inventory', null),
  ('gm', 'Systems', 1, 3, 'gm_sy_terminate_tr', 'Terminate in Talent Reef', null),
  ('gm', 'Systems', 1, 4, 'gm_sy_payroll', 'Send payroll changes to SDO, SOAR Payroll, and Back Office', null),
  ('gm', 'Systems', 1, 5, 'gm_sy_email_sig', 'Change email signature', null),
  ('gm', 'Systems', 1, 6, 'gm_sy_add_alarm', 'Add new GM into the alarm system and call list', null),
  ('gm', 'Systems', 1, 7, 'gm_sy_add_micros', 'Add new GM to Micros / Infor', null),
  ('gm', 'Systems', 1, 8, 'gm_sy_add_whatsapp', 'Add new GM to WhatsApp / Crew App', null),
  ('gm', 'Systems', 1, 9, 'gm_sy_store_email', 'Assist new GM adding store email to their phone', null),
  ('gm', 'Systems', 1, 10, 'gm_sy_add_bank_drop', 'Add new GM to Bank Drop', null),
  ('gm', 'Systems', 1, 11, 'gm_sy_tenure_sheet', 'Update the GM-DO-Location Tenure Google Sheet', null),
  ('gm', 'Misc', 2, 0, 'gm_m_notify_crew', 'Notify the crew', null),
  ('gm', 'Misc', 2, 1, 'gm_m_schedule', 'Adjust the schedule if necessary', null),
  ('gm', 'Misc', 2, 2, 'gm_m_uniform', 'Verify uniform, smallware, Dot-It levels', null),
  ('gm', 'Misc', 2, 3, 'gm_m_recover', 'Recover SOAR property / equipment / keys', null),
  ('gm', 'Misc', 2, 4, 'gm_m_tenure_info', 'Add GM/DO info to Tenure Google Sheet (birthday, hire date, phone number)', null)
on conflict (item_key) do nothing;

notify pgrst, 'reload schema';
