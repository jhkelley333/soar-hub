// Cash Management — money helpers. Everything server-side is integer cents;
// the UI formats for display and parses dollar inputs back to cents.

export function usd(cents: number | null | undefined, opts: { signed?: boolean } = {}): string {
  const c = Number(cents || 0);
  const abs = Math.abs(c) / 100;
  const s = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = c < 0 ? "−" : opts.signed && c > 0 ? "+" : "";
  return `${sign}$${s}`;
}

// Parse a dollar string ("1,234.50" / "1234.5") to integer cents.
export function toCents(input: string | number): number {
  const n = parseFloat(String(input ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// Cents -> editable dollar string ("3180.00").
export function centsToInput(cents: number | null | undefined): string {
  return ((Number(cents || 0)) / 100).toFixed(2);
}
