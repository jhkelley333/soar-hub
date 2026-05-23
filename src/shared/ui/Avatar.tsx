// Initials avatar with optional photo. Strips the leading role token
// (GM / DO / SDO / RVP / VP / COO) from the display name before
// computing initials so "GM Sarah Chen" becomes "SC", not "GS". Matches
// the contacts directory + chat thread design from Claude Design.
//
// When `photoUrl` is set and the image loads, the photo renders in
// place of the initials. A load error silently falls back to initials.

import { useState } from "react";
import { cn } from "@/lib/cn";

function initialsFor(name: string): string {
  const stripped = name.replace(/^(GM|DO|SDO|RVP|VP|COO)\s+/i, "").trim();
  const parts = stripped.split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((p) => p[0]).join("").toUpperCase();
  return letters || "·";
}

export function Avatar({
  name = "",
  photoUrl = null,
  size = 28,
  className,
}: {
  name?: string;
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showPhoto = !!photoUrl && !broken;

  if (showPhoto) {
    return (
      <img
        src={photoUrl as string}
        alt={name}
        onError={() => setBroken(true)}
        className={cn("rounded-full object-cover shrink-0 bg-frost-200", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-frost-200 text-midnight-700 font-medium tabular-nums shrink-0",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsFor(name)}
    </span>
  );
}
