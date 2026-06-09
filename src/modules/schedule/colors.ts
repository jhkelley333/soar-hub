// Shared color logic for the Schedule. Events can be colored two ways:
//   • "type" — by event type (the TYPE_META legend palette)
//   • "org"  — by the org node the event belongs to (a stable hashed color)
// The org palette doubles as the OrgTreeFilter swatch palette, so a store's
// row in the tree matches its events on the grid when coloring by org.

import { TYPE_META, type ScheduleEvent } from "./types";

const ORG_PALETTE: { dot: string; bar: string; swatch: string }[] = [
  { dot: "bg-sky-500",     bar: "border-l-sky-500",     swatch: "bg-sky-500" },
  { dot: "bg-violet-500",  bar: "border-l-violet-500",  swatch: "bg-violet-500" },
  { dot: "bg-emerald-500", bar: "border-l-emerald-500", swatch: "bg-emerald-500" },
  { dot: "bg-amber-500",   bar: "border-l-amber-500",   swatch: "bg-amber-500" },
  { dot: "bg-rose-500",    bar: "border-l-rose-500",    swatch: "bg-rose-500" },
  { dot: "bg-teal-500",    bar: "border-l-teal-500",    swatch: "bg-teal-500" },
  { dot: "bg-indigo-500",  bar: "border-l-indigo-500",  swatch: "bg-indigo-500" },
  { dot: "bg-pink-500",    bar: "border-l-pink-500",    swatch: "bg-pink-500" },
  { dot: "bg-cyan-500",    bar: "border-l-cyan-500",    swatch: "bg-cyan-500" },
  { dot: "bg-lime-500",    bar: "border-l-lime-500",    swatch: "bg-lime-500" },
];

function hashIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % ORG_PALETTE.length;
}

export type ColorBy = "type" | "org";

// Linked-calendar colors — external events always use their calendar's color,
// independent of the type/org toggle.
const EXTERNAL_COLORS: Record<string, { dot: string; bar: string }> = {
  blue: { dot: "bg-blue-500", bar: "border-l-blue-500" },
  green: { dot: "bg-emerald-500", bar: "border-l-emerald-500" },
  purple: { dot: "bg-violet-500", bar: "border-l-violet-500" },
  orange: { dot: "bg-amber-500", bar: "border-l-amber-500" },
  red: { dot: "bg-rose-500", bar: "border-l-rose-500" },
  gray: { dot: "bg-zinc-400", bar: "border-l-zinc-400" },
};
export function externalColor(color: string | null | undefined): { dot: string; bar: string } {
  return EXTERNAL_COLORS[color || "blue"] || EXTERNAL_COLORS.blue;
}

// Swatch bg-class for an org node in the tree. Store rows seed on their
// number so the row color matches the event color in "color by org" mode.
export function orgSwatch(seed: string): string {
  return ORG_PALETTE[hashIndex(seed)].swatch;
}

// {dot, bar} classes for an event under the active coloring mode.
export function eventColor(e: ScheduleEvent, colorBy: ColorBy): { dot: string; bar: string } {
  if (e.source === "external") return externalColor(e.color);
  if (colorBy === "org") {
    const seed = e.store_number || e.scope_id || "org";
    const c = ORG_PALETTE[hashIndex(seed)];
    return { dot: c.dot, bar: c.bar };
  }
  const m = TYPE_META[e.type];
  return { dot: m.dot, bar: m.bar };
}
