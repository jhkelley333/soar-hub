// Birthday celebration modal + confetti shot, fired once per session
// when the signed-in user's birthday is today. Honors Feb-29 →
// Feb-28 fallback in non-leap years (handled by isToday()).
//
// The user's own show_birthday opt-out does NOT suppress this — it's
// their personal moment, not a public display.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";
import { useAuth } from "@/auth/AuthProvider";
import { fetchBirthdays } from "./api";
import { isToday, thisWeekRange } from "./dateRange";

const SESSION_FLAG = "soar.birthdayCelebrated";

// Fires the burst sequence. Returns a cleanup that cancels the
// trailing 400ms shot if the user navigates away mid-celebration —
// without it confetti would still fire on the next page.
function fireConfetti(): () => void {
  const defaults = {
    spread: 70,
    startVelocity: 45,
    ticks: 220,
    gravity: 0.9,
    origin: { y: 0.85 },
  };
  const colors = ["#E40046", "#74D2E7", "#0B0E14", "#FFD166"];
  confetti({ ...defaults, particleCount: 80, origin: { x: 0.2, y: 0.85 }, colors });
  confetti({ ...defaults, particleCount: 80, origin: { x: 0.8, y: 0.85 }, colors });
  const t = setTimeout(() => {
    confetti({ ...defaults, particleCount: 60, origin: { x: 0.5, y: 0.7 }, colors });
  }, 400);
  return () => clearTimeout(t);
}

export function BirthdayCelebration() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);

  const isMyBirthday =
    !!profile?.birthday && isToday(profile.birthday);

  const range = thisWeekRange();
  const teamQuery = useQuery({
    queryKey: ["birthdays-this-week", range.start, range.end],
    queryFn: () => fetchBirthdays(range.start, range.end),
    staleTime: 5 * 60_000,
    enabled: isMyBirthday,
  });

  useEffect(() => {
    if (!isMyBirthday || !profile) return;
    if (sessionStorage.getItem(SESSION_FLAG)) return;
    sessionStorage.setItem(SESSION_FLAG, "1");
    setOpen(true);
    // Slight delay so the modal mount + confetti play together cleanly.
    // Both timeouts (the 150ms launcher + the 400ms trailing shot
    // inside fireConfetti) get cleaned up on unmount so a fast
    // navigation doesn't leave confetti firing on the next page.
    let cancelInner: (() => void) | null = null;
    const startTimer = setTimeout(() => {
      cancelInner = fireConfetti();
    }, 150);
    return () => {
      clearTimeout(startTimer);
      if (cancelInner) cancelInner();
    };
  }, [isMyBirthday, profile]);

  if (!isMyBirthday || !profile) return null;

  const firstName =
    profile.preferred_name?.trim() ||
    profile.full_name?.split(" ")[0] ||
    "there";

  // Count of OTHER people on the team also celebrating this week.
  const others = (teamQuery.data?.entries ?? []).filter(
    (e) => e.id !== profile.id
  ).length;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title=""
      footer={
        <Button onClick={() => setOpen(false)}>Thanks!</Button>
      }
    >
      <div className="flex flex-col items-center text-center">
        <div className="text-4xl">🎉</div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-midnight">
          Happy Birthday, {firstName}!
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Hope it's a great one. The whole team appreciates you.
        </p>
        {others > 0 && (
          <div className="mt-4 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
            🎈 {others === 1 ? "1 other person" : `${others} others`} on your
            team also have a birthday this week.
          </div>
        )}
      </div>
    </Modal>
  );
}
