// COO map — per-district marker styling (shape + color), persisted per browser.
// "Districts" span both brands: Sonic DOs and Little Caesars markets. Choices
// live in localStorage so an exec's customized view survives reloads without a
// backend round-trip (no migration, per-device by design).

export type MarkerShape = "pin" | "circle" | "square" | "diamond" | "triangle" | "star";

export const MARKER_SHAPES: { value: MarkerShape; label: string }[] = [
  { value: "pin", label: "Pin" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "diamond", label: "Diamond" },
  { value: "triangle", label: "Triangle" },
  { value: "star", label: "Star" },
];

export interface GroupStyle { shape: MarkerShape; color: string }

const LS_KEY = "coo-map-marker-styles-v1";

export function loadMarkerStyles(): Record<string, GroupStyle> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, GroupStyle>) : {};
  } catch {
    return {};
  }
}

export function saveMarkerStyles(styles: Record<string, GroupStyle>): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(styles));
  } catch {
    /* ignore quota / disabled storage */
  }
}

// `<input type="color">` only accepts #rrggbb. Palette overflow colors are hsl(),
// so fall back to a neutral for the swatch input (the real color still renders on
// the map until the user picks an override).
export function asHexInput(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#888888";
}
