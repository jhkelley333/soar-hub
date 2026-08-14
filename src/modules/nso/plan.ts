// NSO (New Store Opening) plan model + generator.
//
// The whole plan is anchored to ONE date — the Grand Opening — and every
// other date is stored as an integer OFFSET (days from Grand Opening). That
// makes "pick the open date and the plan builds around it" trivial: change
// the anchor and the entire timeline slides with it, no re-shuffling, while
// any block edits the user made are preserved (they live on offsets, not
// absolute dates). Structure transcribed from the Sonic NSO 3-Week plan deck.

export type WeekKind = "hiring" | "training" | "opening";

/** Visual tone for a day column header — hiring = sky, hands-on training =
 *  cherry (the deck marks training days in RED), practice = amber, opening =
 *  green celebration, rest = zinc. */
export type Tone = "recruit" | "train" | "practice" | "open" | "off";

export interface DayBlock {
  id: string;
  heading: string;
  items: string[];
}

export interface PlanDay {
  id: string;
  /** Days from Grand Opening (negative = before, 0 = opening day). */
  offset: number;
  label: string;
  tone: Tone;
  blocks: DayBlock[];
}

export interface PlanWeek {
  id: string;
  kind: WeekKind;
  title: string;
  subtitle: string;
  /** Optional user override for the displayed week name (the part after
   *  "Week N ·"). Falls back to weekName(kind) when unset. */
  name?: string;
  days: PlanDay[];
}

export interface KeyDate {
  id: string;
  label: string;
  offset: number;
  /** The Grand Opening anchor — edited via the main date picker, not the list. */
  anchor?: boolean;
}

export interface TeamMixRow {
  id: string;
  role: string;
  /** Target headcount needed for this role. */
  count: number;
  /** How many are hired so far (tracks progress against `count`). */
  hired: number;
}

export interface NsoPlan {
  id: string;
  /** Store label, e.g. "Sonic #1056 Dallas TX #1" — also the plan's name. */
  storeName: string;
  storeNumber: string;
  gmName: string;
  fbcName: string;
  address: string;
  /** People this opening is assigned to (free-text names). */
  assignees: string[];
  /** Grand Opening date, YYYY-MM-DD. The anchor for every offset. */
  grandOpeningISO: string;
  weeks: PlanWeek[];
  keyDates: KeyDate[];
  teamMix: TeamMixRow[];
  notes: string;
}

// ---------------------------------------------------------------------------
// id + date helpers
// ---------------------------------------------------------------------------

export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/** Parse a YYYY-MM-DD string into a local Date at noon (avoids TZ/DST drift). */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Grand Opening + offset days → Date. */
export function dateForOffset(grandOpeningISO: string, offset: number): Date {
  const base = parseISO(grandOpeningISO);
  base.setDate(base.getDate() + offset);
  return base;
}

export function offsetForDate(grandOpeningISO: string, iso: string): number {
  const ms = parseISO(iso).getTime() - parseISO(grandOpeningISO).getTime();
  return Math.round(ms / 86_400_000);
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDow(d: Date): string {
  return DOW[d.getDay()];
}
export function fmtMonthDay(d: Date): string {
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}
export function fmtShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function fmtLong(d: Date): string {
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Default plan generation
// ---------------------------------------------------------------------------

function block(heading: string, items: string[]): DayBlock {
  return { id: uid(), heading, items };
}
function day(offset: number, label: string, tone: Tone, blocks: DayBlock[]): PlanDay {
  return { id: uid(), offset, label, tone, blocks };
}

/** Week 1 · Hiring & Onboarding — the week before Training Week (offsets -15..-9). */
export function hiringWeek(startOffset = -15, ordinalTitle = "Week 1"): PlanWeek {
  const s = startOffset;
  return {
    id: uid(),
    kind: "hiring",
    title: `${ordinalTitle} · Hiring & Onboarding`,
    subtitle: "The week before Training Week — staff to the plan",
    days: [
      day(s + 0, "Recruiting", "recruit", [
        block("Recruiting", ["Create job posting (post the prior Thursday)", "Screen applications & phone screens", "Schedule interviews"]),
      ]),
      day(s + 1, "Interviews", "recruit", [
        block("Interviews", ["Group & individual interviews", "Assess fit & availability", "Hire to the staffing plan", "Open interviews at the Drive-In"]),
      ]),
      day(s + 2, "Offers", "recruit", [
        block("Offers", ["Final interviews", "Extend conditional offers", "Initiate background checks"]),
      ]),
      day(s + 3, "Acceptance", "recruit", [
        block("Acceptance", ["Confirm offer acceptances", "Assign roles (Crew, Carhop, Cook)", "Send onboarding invites"]),
      ]),
      day(s + 4, "Onboarding", "recruit", [
        block("Onboarding", ["New-hire paperwork (I-9, W-4)", "Uniform sizing & issue", "Set up payroll profiles"]),
      ]),
      day(s + 5, "Systems & Access", "recruit", [
        block("Systems & Access", ["POS & scheduling logins", "Assign required e-learning", "Confirm background checks cleared"]),
      ]),
      day(s + 6, "Off", "off", [block("Off", ["Rest day — Truck / PreSet prep"])]),
    ],
  };
}

/** Week 2 · Training Week — hands-on operational training (offsets -8..-2). */
export function trainingWeek(startOffset = -8, ordinalTitle = "Week 2"): PlanWeek {
  const s = startOffset;
  return {
    id: uid(),
    kind: "training",
    title: `${ordinalTitle} · Training Week`,
    subtitle: "Hands-on training — Learn It → See It → Do It → Check It",
    days: [
      day(s + 0, "Orientation", "train", [
        block("Orientation", [
          "10:30a–2:30p · Drive-In Leader Orientation (3 hr)",
          "6:00–8:30p · Full Crew Orientation (2 hr)",
          "eLearning 90 min: Orientation · Loyalty · Sonic Safe · CyberSecurity · Chemical",
          "Confirm all team members are 'C' in TR & INFOR",
          "PreSet / station setup completed the day before",
        ]),
      ]),
      day(s + 1, "Learning Day 1", "train", [
        block("FOH · Core", ["Fountain · eL 24 min — UDM/soda, tea, coffee, lemonade, slushes", "Frozen · eL 18 min — shakes, blasts, sundaes, cream slushes"]),
        block("BOH · Core", ["Grill · eL 14 min — burgers, breakfast, hot holding", "Dresser · eL 17 min — set-up, builds, hot holding"]),
      ]),
      day(s + 2, "Learning Day 2", "train", [
        block("FOH · Service", ["Switchboard · eL 9 min", "Drive-Thru · eL 10 min", "Expo · eL 9 min"]),
        block("BOH · Assembly & Prep", ["Back Swamp · eL 15 min", "Front Swamp · eL 15 min", "Prep · eL 12 min"]),
      ]),
      day(s + 3, "Practice Day 1", "practice", [
        block("FOH · Carhop + Practice", ["Carhop · eL 25 min (Skating Carhop optional)", "Practice shifts across all FOH stations", "Trainer supervises AM / MID / PM"]),
        block("BOH · Practice", ["Practice shifts across all BOH stations", "Reinforce hot-holding & food-safety standards", "14–18 crew / 4 hr shift"]),
      ]),
      day(s + 4, "Practice Day 2", "practice", [
        block("Speed & Accuracy", ["All stations to proficiency", "Focus: speed, accuracy & guest experience", "Trainer supervises AM / MID / PM", "14–18 crew / 4 hr shift"]),
      ]),
      day(s + 5, "Certification", "train", [
        block("Certification", ["Log into TOT Zone", "50-question FOH Certification Test", "50-question BOH Certification Test", "Final prep for opening"]),
      ]),
      day(s + 6, "Off", "off", [block("Franchise Off Day", ["Rest before opening"])]),
    ],
  };
}

/** Offset (days from Grand Opening) of the Monday of the Grand Opening's own
 *  calendar week. Keeps every rendered week aligned Monday→Sunday regardless of
 *  which weekday the opening lands on. Tuesday opening → -1 (the classic Sonic
 *  case), so the layout is unchanged for standard openings. */
export function mondayOffsetFor(goISO: string): number {
  const dow = parseISO(goISO).getDay(); // 0 Sun … 6 Sat
  return -((dow + 6) % 7);
}

/** Grand Opening week — a full Mon→Sun calendar week. Days are labelled by
 *  their relationship to opening day (offset 0), so this works for any opening
 *  weekday: Friends & Family the day before, Post-Open after, Final Prep before.
 *  `weekMonday` is the offset of that week's Monday (default -1 = Tue opening). */
export function openingWeek(weekMonday = -1): PlanWeek {
  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const off = weekMonday + i;
    if (off === 0) {
      days.push(day(off, "Grand Opening", "open", [
        block("Grand Opening 🎉", ["Doors open — it's showtime!", "Min 1 support crew member on site", "All hands — celebrate the launch"]),
      ]));
    } else if (off === -1) {
      days.push(day(off, "Friends & Family", "practice", [
        block("Friends & Family", ["Serving 1:00–6:00p", "14–18 total crew for EACH 4 hr shift"]),
      ]));
    } else if (off > 0) {
      days.push(day(off, "Post-Open Support", "open", [block("Post-Open", ["Min 1 supporting DO or Hi-PO GM"])]));
    } else {
      days.push(day(off, "Final Prep", "train", [block("Final Prep", ["Station setup & PreSet complete", "Final readiness walkthrough"])]));
    }
  }
  // Tag the last post-open day with the Support Center note.
  for (let k = days.length - 1; k >= 0; k--) {
    if (days[k].offset > 0) {
      days[k] = { ...days[k], blocks: [block("Post-Open", ["Support Center: busiest 8-hr shift per day", "Maintain momentum & uphold standards"])] };
      break;
    }
  }
  return { id: uid(), kind: "opening", title: "Grand Opening", subtitle: "Open & post-open support", days };
}

export function defaultKeyDates(): KeyDate[] {
  return [
    { id: uid(), label: "First Smallwares Order", offset: -28 },
    { id: uid(), label: "First Food Order", offset: -14 },
    { id: uid(), label: "Truck / PreSet", offset: -9 },
    { id: uid(), label: "Leader Orientation", offset: -8 },
    { id: uid(), label: "Franchise “Off” Day", offset: -2 },
    { id: uid(), label: "Friends & Family", offset: -1 },
    { id: uid(), label: "Grand Opening", offset: 0, anchor: true },
    { id: uid(), label: "Post-Open Support ends", offset: 5 },
  ];
}

export function defaultTeamMix(): TeamMixRow[] {
  return [
    { id: uid(), role: "General Manager", count: 1, hired: 0 },
    { id: uid(), role: "Assistant Manager", count: 2, hired: 0 },
    { id: uid(), role: "Shift Manager / Trainee", count: 3, hired: 0 },
    { id: uid(), role: "Cook (BOH)", count: 8, hired: 0 },
    { id: uid(), role: "Carhop (FOH)", count: 12, hired: 0 },
    { id: uid(), role: "Crew (multi-station)", count: 16, hired: 0 },
  ];
}

/** Snap any date to the Tuesday of that week — Sonic openings are Tuesdays. */
export function nextTuesdayISO(fromISO?: string): string {
  const d = fromISO ? parseISO(fromISO) : new Date();
  d.setHours(12, 0, 0, 0);
  // 2 = Tuesday. Move forward to the next Tuesday (or today if already Tue).
  const delta = (2 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (delta === 0 && !fromISO ? 7 : delta));
  return toISO(d);
}

/** Build the three standard weeks Monday-anchored to a Grand Opening date, so
 *  every week renders Mon→Sun whatever weekday the opening lands on. */
export function standardWeeks(grandOpeningISO: string): PlanWeek[] {
  const mo = mondayOffsetFor(grandOpeningISO);
  return [hiringWeek(mo - 14), trainingWeek(mo - 7), openingWeek(mo)];
}

export function newPlan(grandOpeningISO?: string): NsoPlan {
  const go = grandOpeningISO || nextTuesdayISO();
  return {
    id: uid(),
    storeName: "",
    storeNumber: "",
    gmName: "",
    fbcName: "",
    address: "",
    assignees: [],
    grandOpeningISO: go,
    weeks: standardWeeks(go),
    keyDates: defaultKeyDates(),
    teamMix: defaultTeamMix(),
    notes: "",
  };
}

/** Re-assign every week's day offsets from the current week ORDER so they sit
 *  7 days apart and Monday-anchored, with the opening week anchored at the
 *  Grand Opening. Called after inserting/removing a week so dates cascade and
 *  the Grand Opening stays fixed. */
export function respaceWeeks(plan: NsoPlan): NsoPlan {
  const mo = mondayOffsetFor(plan.grandOpeningISO);
  const openingIdx = plan.weeks.findIndex((w) => w.kind === "opening");
  const anchorIdx = openingIdx < 0 ? plan.weeks.length - 1 : openingIdx;
  const weeks = plan.weeks.map((w, j) => {
    if (w.kind === "opening") return w; // already anchored at mondayOffset
    const weekMonday = mo - 7 * (anchorIdx - j);
    return { ...w, days: w.days.map((d, i) => ({ ...d, offset: weekMonday + i })) };
  });
  return { ...plan, weeks };
}

/** Add an extra hiring or training week. Hiring weeks go to the front (earlier
 *  recruiting runway); training weeks slot in just before the first Training
 *  Week (more ramp time, still after hiring) — never above the hiring weeks.
 *  Offsets are then re-spaced so the Grand Opening stays fixed and everything
 *  renumbers Week 1..N in order. */
export function addWeek(plan: NsoPlan, kind: "hiring" | "training"): NsoPlan {
  const week = kind === "hiring" ? hiringWeek() : trainingWeek();
  let weeks: PlanWeek[];
  if (kind === "hiring") {
    weeks = [week, ...plan.weeks];
  } else {
    let idx = plan.weeks.findIndex((w) => w.kind === "training");
    if (idx < 0) idx = plan.weeks.findIndex((w) => w.kind === "opening");
    if (idx < 0) idx = plan.weeks.length;
    weeks = [...plan.weeks.slice(0, idx), week, ...plan.weeks.slice(idx)];
  }
  return respaceWeeks({ ...plan, weeks });
}

export function removeWeek(plan: NsoPlan, weekId: string): NsoPlan {
  return respaceWeeks({ ...plan, weeks: plan.weeks.filter((w) => w.id !== weekId) });
}

// Displayed title/subtitle are derived from the week's kind + its chronological
// position (index) so adding/removing weeks renumbers everything Week 1..N in
// order — no stale ordinals baked into stored data. `title`/`subtitle` on the
// stored week are ignored for display.
export function weekName(kind: WeekKind): string {
  return kind === "hiring" ? "Hiring & Onboarding" : kind === "training" ? "Training Week" : "Grand Opening";
}
export function weekSubtitle(kind: WeekKind): string {
  return kind === "hiring"
    ? "Hire & onboard to the staffing plan"
    : kind === "training"
      ? "Hands-on training — Learn It → See It → Do It → Check It"
      : "Open & post-open support";
}

/** Move the plan to a new Grand Opening date, keeping every week aligned
 *  Monday→Sunday. Because day offsets are stored relative to opening day, a
 *  move to the SAME weekday needs no re-offset — the whole plan slides and
 *  block edits are preserved. A move to a DIFFERENT weekday re-anchors each
 *  week to its Monday (hiring/training keep their edited blocks by weekday
 *  position; the opening week is rebuilt so Friends & Family / Grand Opening /
 *  Post-Open land on the right days). */
export function reanchorForGrandOpening(plan: NsoPlan, newGoISO: string): NsoPlan {
  const oldDow = parseISO(plan.grandOpeningISO).getDay();
  const newDow = parseISO(newGoISO).getDay();
  if (oldDow === newDow) return { ...plan, grandOpeningISO: newGoISO };

  const newMo = mondayOffsetFor(newGoISO);
  const openingIdx = plan.weeks.findIndex((w) => w.kind === "opening");
  const anchorIdx = openingIdx < 0 ? plan.weeks.length - 1 : openingIdx;
  const weeks = plan.weeks.map((w, j) => {
    const weekMonday = newMo - 7 * (anchorIdx - j);
    if (w.kind === "opening") return { ...openingWeek(weekMonday), id: w.id };
    return { ...w, days: w.days.map((d, i) => ({ ...d, offset: weekMonday + i })) };
  });
  return { ...plan, grandOpeningISO: newGoISO, weeks };
}

export const TONE_STYLES: Record<Tone, { chip: string; ring: string; dot: string }> = {
  recruit: { chip: "bg-accent/10 text-accent", ring: "ring-accent/20", dot: "bg-accent" },
  train: { chip: "bg-cherry/10 text-cherry", ring: "ring-cherry/20", dot: "bg-cherry" },
  practice: { chip: "bg-amber-100 text-amber-700", ring: "ring-amber-200", dot: "bg-amber-500" },
  open: { chip: "bg-emerald-100 text-emerald-700", ring: "ring-emerald-200", dot: "bg-emerald-500" },
  off: { chip: "bg-zinc-100 text-zinc-500", ring: "ring-zinc-200", dot: "bg-zinc-400" },
};

/** Order + names for the day-header color picker (edit mode). */
export const TONE_ORDER: Tone[] = ["recruit", "train", "practice", "open", "off"];
export const TONE_LABELS: Record<Tone, string> = {
  recruit: "Blue",
  train: "Red",
  practice: "Amber",
  open: "Green",
  off: "Gray",
};
