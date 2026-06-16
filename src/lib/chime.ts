// A short, synthesized "new message" chime — no audio asset to ship, just a
// soft two-note ding via the Web Audio API. Used to alert the person actively
// using the app when a chat message arrives (push covers the backgrounded
// case; this covers "app open and focused", where a push can't carry a sound).
//
// Autoplay policy: an AudioContext starts "suspended" until a user gesture, and
// our chime fires from a realtime event — not a gesture. So we resume the
// context on the first interaction (initChimeUnlock) and simply stay silent if
// audio was never unlocked.

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

function unlock(): void {
  if (unlocked) return;
  const c = getCtx();
  if (!c) return;
  c.resume()
    .then(() => {
      unlocked = true;
    })
    .catch(() => {});
}

// Attach once at boot. The first pointer/key event resumes the audio context
// so later chimes can actually play. Listeners are passive and cheap; unlock()
// is idempotent, so leaving them attached is harmless.
export function initChimeUnlock(): void {
  if (typeof window === "undefined") return;
  const handler = () => unlock();
  window.addEventListener("pointerdown", handler, { passive: true });
  window.addEventListener("keydown", handler, { passive: true });
  window.addEventListener("touchstart", handler, { passive: true });
}

export function playChime(): void {
  try {
    const c = getCtx();
    // Not unlocked yet (no gesture this session) → stay silent rather than
    // throw or queue a sound that never plays.
    if (!c || c.state !== "running") return;
    const now = c.currentTime;
    // Two soft sine notes (E5 → A5) with a quick attack and gentle decay.
    const notes = [
      { f: 659.25, t: 0 },
      { f: 880.0, t: 0.11 },
    ];
    for (const { f, t } of notes) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const start = now + t;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    }
  } catch {
    // Audio unavailable / blocked — never let a chime break anything.
  }
}
