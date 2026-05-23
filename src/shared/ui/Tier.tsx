// Tier indicators — the red / yellow / green vocabulary shared across the
// approvals queue, the region rollup, and any other ranked-store view.
// Two flavors:
//   TierBar — a 4px left accent bar absolute-positioned inside a Card.
//   TierDot — a small filled circle (size is configurable for the rollup
//             hero tile, which uses 8px dots inside its 3-up summary).

import { cn } from "@/lib/cn";

export type Tier = "green" | "yellow" | "red";

const TIER_CLASS: Record<Tier, string> = {
  green: "tier-green",
  yellow: "tier-yellow",
  red: "tier-red",
};

export function TierBar({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute left-0 top-2 bottom-2 w-1 rounded-r",
        TIER_CLASS[tier],
        className,
      )}
    />
  );
}

export function TierDot({ tier, size = 6 }: { tier: Tier; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn("dot", TIER_CLASS[tier])}
      style={{ width: size, height: size }}
    />
  );
}
