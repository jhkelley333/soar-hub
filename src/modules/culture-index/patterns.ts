// Culture Index — the knowledge base as structured data.
//
// Source: the user's "Culture Index — Knowledge Base & Site-Build Handoff"
// (paraphrased from their licensed CI "Traits & Patterns" training guide).
// This is the single reference the whole Trait Intelligence feature reads
// from — it powers the reference UI, the clickable trait chips, and (later)
// grounds the AI coaching prompts so guidance quotes THIS material rather
// than generic model output.
//
// IP / compliance: "Culture Index"™ is a proprietary system owned by
// Culture Index, LLC. These paraphrased definitions are for INTERNAL,
// behind-auth reference only. Do not present as an official CI product.

export type SignatureLevel =
  | "low"
  | "mid-low"
  | "mid"
  | "mid-high"
  | "high"
  | "elevated"
  | "n/a";

// The six trait letters (A/B/C/D read vs. the norm line; L/I absolute 0–10).
export interface Signature {
  A: SignatureLevel;
  B: SignatureLevel;
  C: SignatureLevel;
  D: SignatureLevel;
  L: SignatureLevel;
  I: SignatureLevel;
}

export type FamilyId =
  | "autonomous"
  | "analytical"
  | "social"
  | "organizational"
  | "special";

export interface Family {
  id: FamilyId;
  name: string;
  blurb: string;
  /** Tailwind-ish accent hue name used for chips/headers in the UI. */
  hue: "violet" | "sky" | "amber" | "emerald" | "zinc";
}

export const FAMILIES: Family[] = [
  {
    id: "autonomous",
    name: "Autonomous / Visionary",
    blurb: "Proactive Drive, future- and goal-oriented. Take-charge risk-takers.",
    hue: "violet",
  },
  {
    id: "analytical",
    name: "Analytical / Technical",
    blurb: "Reserved, high-logic, accuracy-driven. Depth over speed.",
    hue: "sky",
  },
  {
    id: "social",
    name: "Social / Persuasive",
    blurb: "Proactive Social, people-oriented. Motivate and win people over.",
    hue: "amber",
  },
  {
    id: "organizational",
    name: "Organizational / Structured",
    blurb: "Higher Conformity, a process + people mix. Reliable executors.",
    hue: "emerald",
  },
  {
    id: "special",
    name: "Special cases",
    blurb: "Chameleon (adaptive) and Avoidant (an invalid-survey flag).",
    hue: "zinc",
  },
];

export interface WorkplaceStyle {
  communication: string;
  management: string;
  environment: string;
  motivators: string[];
}

export interface CiPattern {
  id: string; // slug, e.g. "technical-expert"
  name: string; // display, e.g. "Technical Expert"
  family: FamilyId;
  essence: string;
  signature: Signature | null; // null for Avoidant
  strengths: string[];
  watchouts: string[];
  style: WorkplaceStyle | null; // null for Avoidant
  /** True for the Avoidant data-quality flag (not a personality). */
  isFlag?: boolean;
}

// The seven measured constructs (six trait letters + the energy index).
export interface Construct {
  code: "A" | "B" | "C" | "D" | "L" | "I" | "EU";
  name: string;
  kind: "relative" | "absolute" | "index";
  measures: string;
  lowLabel?: string;
  highLabel?: string;
}

export const CONSTRUCTS: Construct[] = [
  {
    code: "A",
    name: "Autonomy / Drive",
    kind: "relative",
    measures: "Assertiveness, independence, willingness to take charge and take risk.",
    lowLabel: "Accommodating · diplomatic · follows policy",
    highLabel: "Take-charge · independent · risk-oriented",
  },
  {
    code: "B",
    name: "Social Ability",
    kind: "relative",
    measures: "Orientation toward people vs. tasks.",
    lowLabel: "Reserved · analytical · works alone",
    highLabel: "Outgoing · persuasive · people-motivated",
  },
  {
    code: "C",
    name: "Pace / Patience",
    kind: "relative",
    measures: "Sense of urgency vs. patience; multitasking vs. single focus.",
    lowLabel: "Patient · methodical · single-focus",
    highLabel: "Urgent · fast · multitasking under pressure",
  },
  {
    code: "D",
    name: "Conformity",
    kind: "relative",
    measures: "Adherence to rules, structure, and detail; self-discipline.",
    lowLabel: "Unstructured · rule-bending · big-picture",
    highLabel: "Detailed · rule-following · dutiful",
  },
  {
    code: "L",
    name: "Logic",
    kind: "absolute",
    measures:
      "Control over emotion when deciding. 0–2 emotive · 3–7 normative · 8–10 pure logic ('Spock').",
  },
  {
    code: "I",
    name: "Ingenuity",
    kind: "absolute",
    measures:
      "Inventiveness / originality. 0–6 literal & practical · 7–10 abstract & inventive.",
  },
  {
    code: "EU",
    name: "Energy Units",
    kind: "index",
    measures:
      "Mental stamina / activity level (0–100). Extremes (0–10, 90–100) flag a possibly invalid/avoidant survey.",
  },
];

// A short read of how far natural vs. adapted graphs diverge — surfaced as a
// coaching note wherever we render a profile.
export const NATURAL_VS_ADAPTED =
  "Small deviation between natural and on-the-job graphs = authentic, sustainable fit. Large deviation = the person is flexing hard to meet the role — effortful, and over time a drain. Watch the EU trend: a drop from natural → job means the role is asking them to work against their grain.";

export const PATTERNS: CiPattern[] = [
  // ── Autonomous / Visionary ───────────────────────────────────────────────
  {
    id: "daredevil",
    name: "Daredevil",
    family: "autonomous",
    essence:
      "Fearless, unconventional, take-charge risk-taker who craves autonomy and lives in the future.",
    signature: { A: "high", B: "mid-high", C: "high", D: "low", L: "high", I: "high" },
    strengths: [
      "Decisive under pressure",
      "Ingenious problem-solving",
      "Delegates freely",
      "Motivates people",
    ],
    watchouts: [
      "Ignores rules and detail ('minutia')",
      "Poor follow-through and recall",
      "Resists structure",
    ],
    style: {
      communication: "Blunt, conceptual, 'tell not sell'",
      management: "Absentee / delegating; few direct reports",
      environment: "Unstructured, fast-paced, change-required",
      motivators: ["Independence", "Financial rewards", "Goal-setting"],
    },
  },
  {
    id: "enterpriser",
    name: "Enterpriser",
    family: "autonomous",
    essence:
      "Assertive, analytical self-starter focused on attaining goals fast, then moving on.",
    signature: { A: "high", B: "low", C: "high", D: "high", L: "high", I: "high" },
    strengths: [
      "Goal attainment",
      "Troubleshooting / problem-solving",
      "Drives change",
      "High standards",
    ],
    watchouts: [
      "Bored by day-to-day maintenance",
      "Blunt / cold with people",
      "Can neglect micro-detail",
      "Combative if wrapped in rules",
    ],
    style: {
      communication: "Factual, authoritative, brusque; email-preferred",
      management: "Authoritarian / instructional; few direct reports",
      environment: "Structured, fast-paced, change-required",
      motivators: ["Independence", "Financial rewards", "Learning / growth", "Goals"],
    },
  },
  {
    id: "philosopher",
    name: "Philosopher",
    family: "autonomous",
    essence:
      "Private, independent conceptual thinker who prefers to work alone and dislikes rules/authority.",
    signature: { A: "high", B: "low", C: "mid", D: "low", L: "high", I: "high" },
    strengths: ["Original, out-of-the-box solutions", "Independent", "Deep thinker"],
    watchouts: [
      "Procrastinates without deadlines",
      "Not a team player / leader",
      "Aloof / indifferent",
      "Resists structure",
    ],
    style: {
      communication: "Cerebral, sometimes vague; email-preferred",
      management: "Autocratic; go-to resource but weak follow-through",
      environment: "Loose / unstructured, project-oriented",
      motivators: ["Freedom / independence", "Private rewards"],
    },
  },
  {
    id: "trailblazer",
    name: "Trailblazer",
    family: "autonomous",
    essence:
      "Competitive, driven self-starter who thrives on winning, mentoring, and constant change.",
    signature: { A: "high", B: "mid", C: "high", D: "low", L: "high", I: "high" },
    strengths: [
      "Competitive drive",
      "Mentors / develops people",
      "Thrives on change",
      "Influences and wins",
    ],
    watchouts: [
      "Short attention / priority-hopping confuses others",
      "Impatient",
      "Can disengage or push work down when bored",
    ],
    style: {
      communication: "Persuasive; can be crisp then hazy",
      management: "Mentoring; moderate reports, delegates",
      environment: "Procrastination-prone, fast-paced, change-required",
      motivators: ["Independence", "Financial rewards", "Public recognition"],
    },
  },
  {
    id: "architect",
    name: "Architect",
    family: "autonomous",
    essence:
      "Proactive, take-charge builder of systems and processes; a conservative, well-calculated risk-taker.",
    signature: { A: "high", B: "low", C: "high", D: "high", L: "high", I: "mid" },
    strengths: [
      "Builds systems / processes",
      "High standards",
      "Relentless follow-through",
      "Drives results",
    ],
    watchouts: [
      "Reluctant to delegate until trust is earned",
      "Blunt / condescending",
      "Impatient",
      "Under-communicates intent",
    ],
    style: {
      communication: "Commanding, detailed; email/text-preferred",
      management: "Authoritarian / instructional; few reports",
      environment: "Precise / structured, fast-paced, change-required",
      motivators: ["Independence", "Financial rewards", "Goal-setting"],
    },
  },
  // ── Analytical / Technical ───────────────────────────────────────────────
  {
    id: "technical-expert",
    name: "Technical Expert",
    family: "analytical",
    essence:
      "Impatient, accuracy-driven expert who corrects others as a duty and needs proof to be convinced.",
    signature: { A: "mid-low", B: "low", C: "mid", D: "high", L: "high", I: "low" },
    strengths: [
      "Accuracy / compliance",
      "Process & system mastery",
      "Problem diagnosis",
      "By-the-book reliability",
    ],
    watchouts: [
      "Micromanages",
      "Won't delegate",
      "Skeptical / slow to trust",
      "Can seem condescending / brusque",
    ],
    style: {
      communication: "Factual, quick, data-heavy; email-preferred",
      management: "Instructional but micromanaging; few reports",
      environment: "Structured, fast-paced, personal space",
      motivators: ["Independence", "Private recognition", "Specialized development"],
    },
  },
  {
    id: "scholar",
    name: "Scholar",
    family: "analytical",
    essence: "Independent, analytical deep-thinker who is knowledge- and quality-driven.",
    signature: { A: "mid", B: "low", C: "mid", D: "mid", L: "high", I: "high" },
    strengths: [
      "Analytical depth",
      "Independent problem-solving",
      "Quality / standards",
      "Masters new systems",
    ],
    watchouts: [
      "Over-analyzes vs. acts",
      "Low people / customer orientation",
      "Disengages from routine",
      "Limited urgency",
    ],
    style: {
      communication: "Reserved, precise; written",
      management: "Autonomous; prefers depth over speed",
      environment: "Independent, low-interruption",
      motivators: ["Intellectual challenge", "Mastery", "Private recognition"],
    },
  },
  {
    id: "specialist",
    name: "Specialist",
    family: "analytical",
    essence:
      "Guarded, hard-working perfectionist; highly critical in their expertise; deeply loyal once trust is earned.",
    signature: { A: "low", B: "low", C: "low", D: "high", L: "high", I: "low" },
    strengths: [
      "Relentless accuracy",
      "Quality / standards",
      "Work ethic",
      "Reliability",
    ],
    watchouts: [
      "Harsh / critical with others",
      "Risk-averse (freezes on the novel)",
      "Thin-skinned",
      "Poor delegator / people-manager",
    ],
    style: {
      communication: "Fast, factual, data-filled; email-preferred",
      management: "Manages process not people; no/few reports",
      environment: "'Pack-rat' system, fast-paced, personal space",
      motivators: ["Independent work", "Personal space", "Private recognition"],
    },
  },
  {
    id: "craftsman",
    name: "Craftsman",
    family: "analytical",
    essence:
      "Reactive, patient, dependable creature of habit who excels at consistent, single-focus work.",
    signature: { A: "low", B: "low", C: "low", D: "mid", L: "high", I: "low" },
    strengths: [
      "Consistency / reliability",
      "Patience with repetitive tasks",
      "Follows process",
      "Accountable start-to-finish",
    ],
    watchouts: [
      "Struggles with fast pace / urgency",
      "Avoids confrontation",
      "Resists change / surprises",
      "Not a natural leader; often lower energy",
    ],
    style: {
      communication: "Detailed, casual; email-preferred",
      management: "Task management; no direct reports",
      environment: "Stable, consistent, harmonic",
      motivators: ["Sincere rewards", "Personal space", "Private recognition"],
    },
  },
  // ── Social / Persuasive ──────────────────────────────────────────────────
  {
    id: "persuader",
    name: "Persuader",
    family: "social",
    essence:
      "Fast, enthusiastic relationship-builder who wins people over and thinks out loud.",
    signature: { A: "high", B: "high", C: "high", D: "low", L: "low", I: "mid" },
    strengths: [
      "Motivates people",
      "Customer rapport",
      "Drives sales / persuasion",
      "Energy under pressure",
    ],
    watchouts: [
      "Follow-through (verbalizing ≠ committing)",
      "Weak documentation / detail",
      "Over-promises",
      "Avoids the negative (discipline)",
    ],
    style: {
      communication: "Effervescent, fast; voicemail-preferred",
      management: "Motivational / lenient; needs to delegate",
      environment: "Busy, change-frequent, needs detail support",
      motivators: ["Independence / income", "Praise in front of others"],
    },
  },
  {
    id: "rainmaker",
    name: "Rainmaker",
    family: "social",
    essence:
      "Assertive, outgoing deal-maker who reads people brilliantly and thrives on relationships.",
    signature: { A: "high", B: "high", C: "high", D: "low", L: "low", I: "mid" },
    strengths: [
      "Relationships / community",
      "Selling / promotion",
      "Persuasion",
      "Morale",
    ],
    watchouts: [
      "Unreliable follow-through",
      "Poor documenter / organizer",
      "Imprecise with facts",
      "Needs structure around them",
    ],
    style: {
      communication: "Enthusiastic, quick; phone/text-preferred",
      management: "Motivational / lenient; needs/wants to delegate",
      environment: "Fast-paced, constant change, detail-assistance required",
      motivators: ["Independence", "Financial rewards", "Public recognition"],
    },
  },
  {
    id: "influencer",
    name: "Influencer",
    family: "social",
    essence:
      "Persuasive, people-connecting motivator who rallies a team and reads a room, with a bit more structure than a Rainmaker.",
    signature: { A: "mid", B: "high", C: "mid", D: "mid", L: "low", I: "mid" },
    strengths: [
      "Rallies / motivates people",
      "Customer warmth",
      "Communication",
      "Adaptable with people",
    ],
    watchouts: [
      "Consistency of standards (may prioritize being liked)",
      "Detail follow-through",
    ],
    style: {
      communication: "Warm, persuasive",
      management: "Shift-lead / assistant-manager fit; needs clear standards",
      environment: "People-rich, steady",
      motivators: ["Social interaction", "Recognition"],
    },
  },
  {
    id: "debater",
    name: "Debater",
    family: "social",
    essence:
      "Friendly, persuasive, laid-back communicator who likes to trade ideas and (gently) argue.",
    signature: { A: "mid", B: "high", C: "low", D: "low", L: "low", I: "mid" },
    strengths: [
      "Liaison / communication",
      "Patience with people",
      "Morale",
      "Persuasion",
    ],
    watchouts: [
      "Argumentative / non-conformist",
      "Avoids confrontation / discipline",
      "Gets socially distracted",
      "Needs direction",
    ],
    style: {
      communication: "Easy-going, conceptual; voicemail-preferred",
      management: "Needs direction; facilitates through others",
      environment: "Socially oriented, steady, detail-assistance",
      motivators: ["Social interaction", "Financial rewards", "Public recognition"],
    },
  },
  {
    id: "socializer",
    name: "Socializer",
    family: "social",
    essence:
      "The most people-driven pattern — flamboyant, warm, happiest surrounded by people.",
    signature: { A: "mid", B: "high", C: "mid", D: "low", L: "low", I: "mid" },
    strengths: [
      "Customer experience / hospitality",
      "Morale",
      "Welcoming presence",
      "Selling",
    ],
    watchouts: [
      "Distractible",
      "Poor follow-through / documentation",
      "Needs imposed structure",
      "Avoids detail work",
    ],
    style: {
      communication: "Gregarious, colorful; voicemail-preferred",
      management: "Likes / needs to delegate; motivates easily",
      environment: "Easy-going, people-rich, stable",
      motivators: ["Social interaction", "Status / money", "Praise in front of others"],
    },
  },
  // ── Organizational / Structured ──────────────────────────────────────────
  {
    id: "administrator",
    name: "Administrator",
    family: "organizational",
    essence:
      "Optimistic, organized team-builder who teaches new people and keeps things tidy.",
    signature: { A: "mid", B: "high", C: "mid", D: "high", L: "mid", I: "low" },
    strengths: ["Trains / onboards", "Organizes", "Team leadership", "Morale"],
    watchouts: [
      "Dislikes tedious technical / analytical detail",
      "Needs recognition",
      "Can be distracted",
      "Occasional sharp comments",
    ],
    style: {
      communication: "Fast, detailed; voicemail-preferred",
      management: "Teaches new employees; 'takes you under their wing'",
      environment: "Almost compulsively neat, group-oriented, change-experiencing",
      motivators: ["Reinforcement in front of others", "Bonuses", "Titles"],
    },
  },
  {
    id: "coordinator",
    name: "Coordinator",
    family: "organizational",
    essence:
      "Optimistic, animated organizer of people and tasks who runs on rules and structure.",
    signature: { A: "mid", B: "mid-high", C: "high", D: "high", L: "mid", I: "low" },
    strengths: [
      "Coordinates people / tasks / schedules",
      "Communicates",
      "Detail with structure",
      "Tidy",
    ],
    watchouts: [
      "Defensive (not assertive) when corrected",
      "Needs rules & direction",
      "Risk-averse",
      "Not big-picture strategy",
    ],
    style: {
      communication: "Fast, detailed; phone/text",
      management: "Instructional; few reports, task-oriented projects",
      environment: "Socially oriented, change-required, orderly",
      motivators: ["Social interaction", "Position titles", "Public recognition"],
    },
  },
  {
    id: "facilitator",
    name: "Facilitator",
    family: "organizational",
    essence:
      "Polite, methodical, single-focus team player who executes tasks exactly and reliably.",
    signature: { A: "low", B: "mid", C: "low", D: "high", L: "mid", I: "low" },
    strengths: [
      "Methodical task execution",
      "Follows procedures exactly",
      "Reliable",
      "Good listener / support",
    ],
    watchouts: [
      "Rattled by change / surprise",
      "Struggles with fast pace",
      "Over-commits (won't say no)",
      "Avoids people-management / confrontation",
    ],
    style: {
      communication: "Detailed, casual; phone-preferred",
      management: "Needs direction; task management, no reports",
      environment: "Orderly, stable, detail-oriented",
      motivators: ["Social interaction", "Constant reassurance", "Recognition"],
    },
  },
  {
    id: "operator",
    name: "Operator",
    family: "organizational",
    essence:
      "Easy-going, heads-down processor of tasks who prizes stability and does repetitive work seamlessly.",
    signature: { A: "low", B: "low", C: "low", D: "high", L: "mid", I: "low" },
    strengths: [
      "Reliable repetitive-task execution",
      "Detail / accuracy",
      "By-the-book compliance",
      "Steady / loyal",
    ],
    watchouts: [
      "Dislikes multitasking / fast pace",
      "Resists change",
      "Low people / customer orientation",
      "Needs defined duties",
    ],
    style: {
      communication: "Slow, factual; email-preferred",
      management: "Needs direction; task management, no reports",
      environment: "Systematic, stable, harmonic",
      motivators: ["Risk-free", "Predictability", "Private recognition"],
    },
  },
  {
    id: "traditionalist",
    name: "Traditionalist",
    family: "organizational",
    essence:
      "Due-diligent, history-minded worrier obsessed with 'getting it right' and following 'the Book.'",
    signature: { A: "low", B: "mid-low", C: "low", D: "high", L: "mid", I: "low" },
    strengths: [
      "Procedural accuracy / compliance",
      "Work ethic",
      "Institutional knowledge",
      "Supportive / unselfish",
    ],
    watchouts: [
      "Perfectionism can miss deadlines",
      "Worry / thin skin",
      "Struggles with change / surprises & pace",
      "Avoids confrontation",
    ],
    style: {
      communication: "Factual, lengthy; email-preferred",
      management: "Needs direction; task management, no reports",
      environment: "Systematic, stable, harmonic",
      motivators: ["Risk-free", "Constant reassurance", "Private recognition"],
    },
  },
  // ── Special cases ────────────────────────────────────────────────────────
  {
    id: "chameleon",
    name: "Chameleon",
    family: "special",
    essence:
      "All behavioral drives elevated and balanced — a highly adaptable person who flexes to the situation.",
    signature: {
      A: "elevated",
      B: "elevated",
      C: "elevated",
      D: "elevated",
      L: "mid",
      I: "mid",
    },
    strengths: [
      "Adaptability across situations",
      "Can lead, serve, and multitask at once",
      "High capacity",
    ],
    watchouts: [
      "Adaptability can tip into people-pleasing or inconsistent standards",
      "Over-extension / burnout",
      "If Logic is low, emotional reactivity under stress",
    ],
    style: {
      communication: "Flexes to context",
      management: "Adapts to the team in front of them",
      environment: "Best paired with a firm anchor on standards",
      motivators: ["Varies with context"],
    },
  },
  {
    id: "avoidant",
    name: "Avoidant",
    family: "special",
    isFlag: true,
    essence:
      "Not a personality — a data-quality flag. The natural-traits plot is blank/flagged with EU in the 0–10 or 90–100 band, meaning the survey is invalid or avoidant (often a language/literacy issue or non-committal answers).",
    signature: null,
    strengths: [],
    watchouts: [
      "Do NOT use for personality-fit decisions",
      "Re-administer — confirm primary language and comprehension",
      "Interview on experience only until a valid survey exists",
    ],
    style: null,
  },
];

// ── Lookups ─────────────────────────────────────────────────────────────────

const byId = new Map(PATTERNS.map((p) => [p.id, p]));
const byName = new Map(PATTERNS.map((p) => [normalize(p.name), p]));

function normalize(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Resolve a stored `cultural_index_trait` string (the pattern NAME, e.g.
 * "Technical Expert" or "Debater") to its full definition. Tolerant of case,
 * spacing, and punctuation. Returns undefined if the trait doesn't map to a
 * known pattern (e.g. a typo or a legacy value).
 */
export function patternForTrait(trait: string | null | undefined): CiPattern | undefined {
  if (!trait) return undefined;
  const n = normalize(trait);
  return byName.get(n) ?? byId.get(trait) ?? undefined;
}

export function familyOf(id: FamilyId): Family | undefined {
  return FAMILIES.find((f) => f.id === id);
}

export function patternsByFamily(id: FamilyId): CiPattern[] {
  return PATTERNS.filter((p) => p.family === id);
}
