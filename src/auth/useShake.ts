// Shake-to-jiggle plumbing for the launch splash. Listens to the device
// accelerometer and fires onShake when the motion delta crosses a
// threshold. iOS 13+ gates DeviceMotion behind a permission prompt that
// must be triggered from a user gesture — call enableMotion() from a tap
// (the splash does this on the first cup tap) to unlock it; elsewhere it
// resolves true and the listener just works.

import { useEffect, useRef } from "react";

type RequestPermissionDME = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export async function enableMotion(): Promise<boolean> {
  const DME = window.DeviceMotionEvent as RequestPermissionDME | undefined;
  if (DME && typeof DME.requestPermission === "function") {
    try {
      return (await DME.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true; // no gating on Android / desktop
}

export function useShake(onShake: () => void, enabled = true) {
  const cb = useRef(onShake);
  cb.current = onShake;

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
      return;
    }
    const last = { x: 0, y: 0, z: 0, t: 0 };
    const THRESHOLD = 14; // m/s² of jerk — a deliberate shake, not a wobble

    function handle(e: DeviceMotionEvent) {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const now = Date.now();
      if (now - last.t < 130) return; // debounce
      const dx = (a.x ?? 0) - last.x;
      const dy = (a.y ?? 0) - last.y;
      const dz = (a.z ?? 0) - last.z;
      const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (last.t && delta > THRESHOLD) cb.current();
      last.x = a.x ?? 0;
      last.y = a.y ?? 0;
      last.z = a.z ?? 0;
      last.t = now;
    }

    window.addEventListener("devicemotion", handle);
    return () => window.removeEventListener("devicemotion", handle);
  }, [enabled]);
}
