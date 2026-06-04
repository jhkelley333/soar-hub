// Walkthrough — sample template + assignment for the preview runner.
//
// There's no walkthrough backend table yet (submit + migration is the next
// ticket), so the runner mounts this fixture the same way the other 2026
// mobile previews seed local sample data. Mirrors the "Weekly Walkthrough"
// shown in the design canvas: 7 sections, photo-on-every-fail, green ≥ 85.
// When the real template API lands, swap this for a fetch — the components
// don't care where the template comes from.

import type {
  CheckInStore,
} from "./CheckIn";
import type { WalkthroughAssignment, WalkthroughTemplate } from "./types";

const FAIL_RULE = {
  trigger: "fail" as const,
  require: { photo: 1, reason: true },
  reasonOptions: ["Equipment", "Cleanliness", "Staffing", "Stock-out", "Safety", "Other"],
  raiseCorrectiveAction: true,
};

const WATCH_RULE = {
  trigger: "watch" as const,
  require: { reason: true, note: true },
  reasonOptions: ["Borderline", "Trending down", "Intermittent", "Other"],
};

const rules = [FAIL_RULE, WATCH_RULE];

export const SAMPLE_TEMPLATE: WalkthroughTemplate = {
  id: "tmpl_weekly_walkthrough",
  version: "2.3",
  name: "Weekly Walkthrough",
  type: "walkthrough",
  scoring: { pass: 1, watch: 0.6, fail: 0 },
  tiers: { green: 85, yellow: 70 },
  globalRules: { photoOnEveryFail: true, allowNa: false },
  sections: [
    {
      code: "LOT",
      name: "Lot & exterior",
      items: [
        { code: "LOT.01", label: "Lot free of litter & debris", weight: 1, severity: "low", rules },
        { code: "LOT.02", label: "Stall canopies & lighting intact", weight: 1, severity: "med", rules },
        { code: "LOT.03", label: "Signage clean & fully lit", weight: 1, severity: "low", rules },
      ],
    },
    {
      code: "FRY",
      name: "Fryer & line",
      items: [
        { code: "FRY.01", label: "Oil quality within spec (TPM)", weight: 2, severity: "high", rules },
        { code: "FRY.02", label: "Line temps logged this shift", weight: 2, severity: "high", rules },
        { code: "FRY.03", label: "LTO build photo matches spec", weight: 1, severity: "med", rules },
      ],
    },
    {
      code: "FTN",
      name: "Fountain",
      items: [
        { code: "FTN.01", label: "Nozzles & diffusers clean", weight: 1, severity: "med", rules },
        { code: "FTN.02", label: "Carbonation & syrup ratios correct", weight: 1, severity: "med", rules },
      ],
    },
    {
      code: "DT",
      name: "Drive-thru",
      items: [
        { code: "DT.01", label: "Headset clarity & charge", weight: 1, severity: "low", rules },
        { code: "DT.02", label: "Order accuracy spot check (5 cars)", weight: 2, severity: "high", rules },
        { code: "DT.03", label: "Menu board legibility & lighting", weight: 1, severity: "med", rules },
        { code: "DT.04", label: "Avg service time ≤ 3:30", weight: 2, severity: "high", rules },
      ],
    },
    {
      code: "PAT",
      name: "Patio & stalls",
      items: [
        { code: "PAT.01", label: "Tables & trash bins clean", weight: 1, severity: "low", rules },
        { code: "PAT.02", label: "Call buttons responsive ≤ 4s", weight: 1, severity: "med", rules },
      ],
    },
    {
      code: "RST",
      name: "Restrooms",
      items: [
        { code: "RST.01", label: "Stocked & sanitized", weight: 1, severity: "med", rules },
        { code: "RST.02", label: "No fixtures out of order", weight: 1, severity: "med", rules },
      ],
    },
    {
      code: "CLS",
      name: "Close-out",
      items: [
        { code: "CLS.01", label: "Cash drawer reconciled", weight: 1, severity: "high", rules },
        { code: "CLS.02", label: "Walk-in & reach-in temps logged", weight: 2, severity: "high", rules },
      ],
    },
  ],
};

export const SAMPLE_STORE: CheckInStore = {
  sdi: "4287",
  name: "Mansfield, TX",
  lat: 32.5632,
  lng: -97.1417,
  radiusM: 150,
};

export const SAMPLE_ASSIGNMENT: WalkthroughAssignment = {
  id: "asg_sample_4287_weekly",
  templateId: SAMPLE_TEMPLATE.id,
  templateVersion: SAMPLE_TEMPLATE.version,
  storeSdi: SAMPLE_STORE.sdi,
  assigneeUserId: "me",
  dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  status: "in_progress",
};
