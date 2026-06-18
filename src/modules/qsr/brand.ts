// SOAR QSR Learning Platform — design tokens.
//
// First pass from the build prompt's brand summary. These mirror the CSS
// custom properties in globals.css (--color-qsr-*, --font-qsr-*) for use in
// inline styles / JS. Reconcile verbatim against brand.jsx when the prototype
// folder is attached.
export const qsrBrand = {
  azure: "#0B5FA5", // SONIC azure — primary
  crimson: "#EA0F44", // SOAR crimson — accent / CTA
  gold: "#FFC62E", // highlight / rewards
  fonts: {
    display: '"Bricolage Grotesque", "Inter", ui-sans-serif, system-ui, sans-serif',
    ui: '"Hanken Grotesk", "Inter", ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
} as const;
