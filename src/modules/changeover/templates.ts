// Store changeover checklist templates, transcribed from the SOAR QSR
// "DO/SDO Changeover" and "GM/AGM Changeover" sheets. The app owns these; the
// backend only stores per-item progress keyed by `key`. Keys are stable — never
// renumber an existing item (old checklists reference it); append new ones.

export type ChangeoverKind = "do" | "gm";

export interface ChecklistItem {
  key: string;
  label: string;
  hint?: string;
}
export interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}
export interface ChecklistTemplate {
  kind: ChangeoverKind;
  title: string;          // shown as the checklist heading
  who: string;            // one-liner: who runs it, for whom
  subjectLabel: string;   // label for the person leaving (outgoing_name)
  incomingLabel: string;  // label for the person arriving (incoming_name)
  sections: ChecklistSection[];
}

const DO_TEMPLATE: ChecklistTemplate = {
  kind: "do",
  title: "DO / SDO Changeover",
  who: "Run by an SDO/RVP when a DO changes over.",
  subjectLabel: "Previous DO",
  incomingLabel: "New DO",
  sections: [
    {
      title: "Remove System Access",
      items: [
        { key: "do_ra_soar_email", label: "SOAR Email (Notify Back Office)" },
        { key: "do_ra_qsr_online", label: "QSR Online (SDO — send in a support ticket)" },
        { key: "do_ra_talent_reef", label: "Talent Reef (SDO)" },
        { key: "do_ra_micros_infor", label: "Delete Micros / Infor access", hint: "Micros: remove the POS password before deactivating the account. Infor: don't terminate until after Payroll." },
        { key: "do_ra_iacm", label: "IACM Access (SDO)" },
        { key: "do_ra_partnernet", label: "Partnernet (SDO — Solugenix ticket)" },
        { key: "do_ra_whatcookin", label: "Remove from WhatCookin' (Partnernet Communications page)" },
        { key: "do_ra_totzone", label: "TOTZONE (SDO — Solugenix ticket)" },
        { key: "do_ra_whatsapp", label: "Remove from WhatsApp / Crew App" },
        { key: "do_ra_inv_xpress", label: "Inventory Xpress (SDO — support ticket)" },
        { key: "do_ra_sync_reports", label: "Sync Reports / VOC / Mystery Shops", hint: "Email: marika.chambers@inspirebrands.com" },
        { key: "do_ra_alarm", label: "Alarm System access and call list" },
        { key: "do_ra_bank_drops", label: "Bank Drops" },
        { key: "do_ra_web_safes", label: "Web-Based Safes" },
        { key: "do_ra_icm_dd_ue", label: "ItsACheckmate, DoorDash & Uber Eats portal access" },
        { key: "do_ra_barco_vendor", label: "Barco & food vendor online access" },
        { key: "do_ra_cameras", label: "Security cameras remote access", hint: "If Zosi, contact Adam." },
        { key: "do_ra_rap", label: "RAP Access (Notify Adam)" },
        { key: "do_ra_email_groups", label: "SOAR email groups (Notify Adam)" },
        { key: "do_ra_tr_8100", label: "Move new DO in TR to 8100 (Notify Adam)" },
        { key: "do_ra_amazon", label: "Remove from Amazon Business (Notify Adam)" },
      ],
    },
    {
      title: "Misc",
      items: [
        { key: "do_m_rekey", label: "Rekey doors if necessary" },
        { key: "do_m_deposits", label: "Verify all store deposits are at the bank" },
        { key: "do_m_petty_cash", label: "Verify all stores' petty cash / cash drawer / changer amounts" },
        { key: "do_m_terminate_tr", label: "Terminate in Talent Reef" },
        { key: "do_m_payroll", label: "Send payroll changes to SDO, SOAR Payroll, and Back Office" },
        { key: "do_m_hierarchy", label: "Update hierarchy list on all platforms (Notify Alex)" },
        { key: "do_m_micros_stores", label: "Update stores in Micros — email EM@sonicdrivein.com", hint: "\"Remove (Former DO name) access and move stores to (New DO).\"" },
        { key: "do_m_infor_stores", label: "Update stores in Infor User Maintenance for Infor POS" },
        { key: "do_m_tr_username", label: "Create a DO username in Talent Reef" },
        { key: "do_m_qsr_username", label: "Create a DO username in QSR Online" },
        { key: "do_m_recover", label: "Recover SOAR property / equipment / keys" },
        { key: "do_m_notify_gms", label: "Notify General Managers" },
      ],
    },
  ],
};

const GM_TEMPLATE: ChecklistTemplate = {
  kind: "gm",
  title: "GM / AGM Changeover",
  who: "Run by a DO when a GM changes over.",
  subjectLabel: "Outgoing GM",
  incomingLabel: "New GM",
  sections: [
    {
      title: "Security",
      items: [
        { key: "gm_s_partnernet_pw", label: "First — change the Partnernet password" },
        { key: "gm_s_qsr_pw", label: "Change password for QSR Online" },
        { key: "gm_s_tr_pw", label: "Change password for Talent Reef" },
        { key: "gm_s_micros_infor", label: "Delete Micros / Infor access", hint: "Micros: remove the POS password before deactivating the account. Infor: don't terminate until after Payroll." },
        { key: "gm_s_whatsapp", label: "Remove from WhatsApp / Crew App" },
        { key: "gm_s_totzone", label: "Remove from TOTZONE" },
        { key: "gm_s_alarm", label: "Remove from alarm system and call list" },
        { key: "gm_s_bank_drop", label: "Remove from Bank Drop" },
        { key: "gm_s_cameras", label: "Remove security camera access" },
        { key: "gm_s_rekey", label: "Rekey doors if necessary" },
      ],
    },
    {
      title: "Systems",
      items: [
        { key: "gm_sy_deposits", label: "Verify deposits are at the bank" },
        { key: "gm_sy_petty_cash", label: "Verify petty cash / cash drawer / changer amounts" },
        { key: "gm_sy_inventory", label: "Verify inventory" },
        { key: "gm_sy_terminate_tr", label: "Terminate in Talent Reef" },
        { key: "gm_sy_payroll", label: "Send payroll changes to SDO, SOAR Payroll, and Back Office" },
        { key: "gm_sy_email_sig", label: "Change email signature" },
        { key: "gm_sy_add_alarm", label: "Add new GM into the alarm system and call list" },
        { key: "gm_sy_add_micros", label: "Add new GM to Micros / Infor" },
        { key: "gm_sy_add_whatsapp", label: "Add new GM to WhatsApp / Crew App" },
        { key: "gm_sy_store_email", label: "Assist new GM adding store email to their phone" },
        { key: "gm_sy_add_bank_drop", label: "Add new GM to Bank Drop" },
        { key: "gm_sy_tenure_sheet", label: "Update the GM-DO-Location Tenure Google Sheet" },
      ],
    },
    {
      title: "Misc",
      items: [
        { key: "gm_m_notify_crew", label: "Notify the crew" },
        { key: "gm_m_schedule", label: "Adjust the schedule if necessary" },
        { key: "gm_m_uniform", label: "Verify uniform, smallware, Dot-It levels" },
        { key: "gm_m_recover", label: "Recover SOAR property / equipment / keys" },
        { key: "gm_m_tenure_info", label: "Add GM/DO info to Tenure Google Sheet (birthday, hire date, phone number)" },
      ],
    },
  ],
};

export const CHANGEOVER_TEMPLATES: Record<ChangeoverKind, ChecklistTemplate> = { do: DO_TEMPLATE, gm: GM_TEMPLATE };

export function templateFor(kind: ChangeoverKind): ChecklistTemplate {
  return CHANGEOVER_TEMPLATES[kind];
}
export function itemCount(kind: ChangeoverKind): number {
  return CHANGEOVER_TEMPLATES[kind].sections.reduce((n, s) => n + s.items.length, 0);
}
export function allItemKeys(kind: ChangeoverKind): string[] {
  return CHANGEOVER_TEMPLATES[kind].sections.flatMap((s) => s.items.map((i) => i.key));
}
