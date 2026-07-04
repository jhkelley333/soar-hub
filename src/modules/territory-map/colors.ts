// Territory Map — deterministic, high-contrast pin color per DO.
//
// The color is derived from the DO's profile id (a stable uuid), so pins
// never shuffle hue between page loads or when the store list reorders.
// A curated palette covers the common case (readable on the light map
// tiles, distinguishable from each other); when there are more DOs than
// palette entries, overflow ids fall back to a golden-angle HSL walk seeded
// from the same hash — still deterministic, just less hand-picked.
//
// "DO OPEN" (unassigned district) is a fixed dark gray, deliberately
// outside the palette so open territories read as gaps at a glance.

const PALETTE = [
  "#e6194b", // red
  "#3cb44b", // green
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#9a6324", // brown
  "#800000", // maroon
  "#000075", // navy
  "#808000", // olive
  "#469990", // teal
  "#dcbeff", // lavender
  "#fabed4", // pink
  "#ffd8b1", // apricot
  "#aaffc3", // mint
  "#bfef45", // lime
  "#ffe119", // yellow
];

export const DO_OPEN_COLOR = "#52525b"; // zinc-600 — unassigned districts

// FNV-1a — tiny, stable string hash. Good enough distribution for
// bucketing a few dozen uuids into palette slots.
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Assign colors to a set of DO ids at once. Sorting first means every
// client with the same DO list computes the same assignment (index-based,
// collision-free up to the palette size) regardless of fetch order.
export function colorsForDos(doIds: string[]): Map<string, string> {
  const sorted = [...new Set(doIds)].sort();
  const out = new Map<string, string>();
  sorted.forEach((id, i) => {
    if (i < PALETTE.length) {
      out.set(id, PALETTE[i]);
    } else {
      // Golden-angle hue walk for overflow — deterministic from the hash.
      const hue = (hash(id) % 360 + i * 137.508) % 360;
      out.set(id, `hsl(${Math.round(hue)}, 70%, 45%)`);
    }
  });
  return out;
}
