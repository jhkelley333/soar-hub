// Coaching for Performance — Tool Kit metadata. A phone-first reference that
// turns the printed coaching zine into an interactive card chooser. Each tool
// is color-coded by a single hue (only the hue varies, so the palette stays
// harmonious); the detail bodies live in ToolDetailPage.
import {
  RefreshCw, MessageCircle, HelpCircle, Gauge, Footprints, Wind, SlidersHorizontal, type LucideIcon,
} from "lucide-react";

export type ToolId = "improve" | "habit" | "telling" | "dial" | "walk" | "mindfulness" | "slii";

export interface CoachTool {
  id: ToolId;
  title: string;
  subtitle: string;   // home-row sub
  category: string;   // home-row category label
  icon: LucideIcon;
  hue: number;
  eyebrow: string;    // detail hero eyebrow
  intro: string;      // detail hero intro
  source?: string;    // optional attribution line
}

// Derive a tool's accent + tint from its single hue. Constant lightness &
// chroma keeps every tool visually related.
export function chipVars(hue: number): { chip: string; soft: string } {
  return { chip: `oklch(0.55 0.13 ${hue})`, soft: `oklch(0.95 0.035 ${hue})` };
}

export const TOOLS: CoachTool[] = [
  {
    id: "improve", title: "Coaching to Improve", subtitle: "Six questions for continuous improvement",
    category: "Ask better", icon: RefreshCw, hue: 200,
    eyebrow: "Continuous improvement",
    intro: "A pattern of six questions that build commitment and skills for continuous improvement.",
  },
  {
    id: "habit", title: "The Coaching Habit", subtitle: "Seven questions — say less, ask more",
    category: "Ask better", icon: MessageCircle, hue: 250,
    eyebrow: "Say less, ask more",
    intro: "Seven powerful questions that change the way you lead — forever.",
    source: "The Coaching Habit · Michael Bungay Stanier",
  },
  {
    id: "telling", title: "Out of the Habit of Telling", subtitle: "Three practices + a feedback frame",
    category: "Ask better", icon: HelpCircle, hue: 285,
    eyebrow: "Coach, don't tell",
    intro: "Three practices for breaking the habit of telling — plus a frame for direct, helpful feedback.",
    source: "Practices · Katie Anderson (used by permission)",
  },
  {
    id: "dial", title: "The Accountability Dial", subtitle: "Get things done without micromanaging",
    category: "In the moment", icon: Gauge, hue: 42,
    eyebrow: "Accountability",
    intro: "A five-step dial for getting things done without micromanaging. Escalate only as far as you need.",
    source: "bunch.ai · Getting Things Done",
  },
  {
    id: "walk", title: "The Sonic Readiness Walk", subtitle: "The Lens of Excellence, right now",
    category: "In the moment", icon: Footprints, hue: 78,
    eyebrow: "On the floor",
    intro: "A guided walk of the store through the Lens of Excellence — and the three positions to coach from.",
  },
  {
    id: "slii", title: "SLII at Sonic", subtitle: "Assess the task, match your leadership style",
    category: "Match your style", icon: SlidersHorizontal, hue: 160,
    eyebrow: "Situational leadership",
    intro: "Development level is per task, not per person. Assess a team member's capability and commitment on one specific goal, task, or skill — then flex your leadership style to what they need right now.",
    source: "SLII \u00b7 The Ken Blanchard Companies \u2014 adapted for Sonic",
  },
  {
    id: "mindfulness", title: "Practice Mindfulness", subtitle: "Be present, lead clearly",
    category: "Self-regulation", icon: Wind, hue: 330,
    eyebrow: "Be present",
    intro: "Mindfulness is focusing your awareness on the present moment. A mindful leader brings focus, awareness, clear decisions, and effective communication.",
  },
];

export const TOOL_BY_ID: Record<ToolId, CoachTool> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
) as Record<ToolId, CoachTool>;
