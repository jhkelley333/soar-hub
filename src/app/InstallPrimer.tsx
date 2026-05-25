// First-run "install to home screen" nudge — the thing that turns a
// browser visitor into a one-tap home-screen app. Two paths:
//
//   • Chromium (Android desktop/mobile, Edge): the browser fires
//     `beforeinstallprompt`, which we capture and replay behind our own
//     "Install" button so the OS install dialog appears on a real tap.
//   • iOS Safari: there is NO install API — the only way in is Share →
//     "Add to Home Screen". We can't trigger it, so we show a short
//     instruction card instead.
//
// Self-gates hard: never shown once installed (standalone), never on a
// browser that can't install (iOS Chrome/Firefox, desktop Safari/FF that
// don't fire the event), and never again after dismiss/install. AppShell
// holds it until the launch splash clears and shows it INSTEAD of the
// push primer so the two bottom cards never stack.

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { isIOS, isStandalone } from "@/lib/push";

const DISMISS_KEY = "soar-install-primer-dismissed";

// `beforeinstallprompt` isn't in the TS DOM lib yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// iOS Safari is the only iOS browser that can Add to Home Screen — Chrome
// (CriOS) / Firefox (FxiOS) / Edge (EdgiOS) on iOS cannot, so showing the
// Share-sheet tip there would be a dead end.
function isIOSSafari(): boolean {
  return isIOS() && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
}

type InstallStatus = "unavailable" | "android" | "ios";

export interface InstallPrompt {
  show: boolean;
  status: InstallStatus;
  promptInstall: () => Promise<void>;
  dismiss: () => void;
}

// Owns the captured install event + dismissal state. Call once (AppShell
// does) and pass the result to <InstallPrimer/>, so there's a single
// listener and the show/suppress decision is shared with the push primer.
export function useInstallPrompt(): InstallPrompt {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(
    () => !!localStorage.getItem(DISMISS_KEY),
  );

  useEffect(() => {
    const onBIP = (e: Event) => {
      // Stop Chromium's own mini-infobar; we drive the prompt ourselves.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      localStorage.setItem(DISMISS_KEY, "1");
      setDismissed(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const status: InstallStatus = isStandalone()
    ? "unavailable"
    : deferred
      ? "android"
      : isIOSSafari()
        ? "ios"
        : "unavailable";

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const promptInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice; // accepted or dismissed — either way we're done
    setDeferred(null);
    // Don't re-nag. A true install also fires `appinstalled`; a decline
    // means they saw the dialog and chose not to, so stop asking.
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return { show: status !== "unavailable" && !dismissed, status, promptInstall, dismiss };
}

export function InstallPrimer({ status, promptInstall, dismiss }: InstallPrompt) {
  const ios = status === "ios";
  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] px-4 pb-24 lg:pb-4">
      <div className="mx-auto max-w-md rounded-2xl bg-surface p-4 shadow-xl ring-1 ring-midnight-100">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            {ios ? (
              <Share className="h-5 w-5" strokeWidth={2} />
            ) : (
              <Download className="h-5 w-5" strokeWidth={2} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-midnight-900">
              Add SOAR Hub to your home screen
            </p>
            <p className="mt-0.5 text-[13px] text-midnight-600">
              {ios ? (
                <>
                  Tap the Share icon, then{" "}
                  <span className="font-medium text-midnight-800">Add to Home Screen</span>{" "}
                  — it opens full-screen and you stay signed in.
                </>
              ) : (
                "Install it for one-tap access — opens full-screen and you stay signed in."
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 rounded-full p-1 text-midnight-400 hover:bg-surface-muted"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {ios ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={dismiss}
              className="h-10 w-full rounded-lg bg-accent text-[14px] font-semibold text-white"
            >
              Got it
            </button>
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="h-10 flex-1 rounded-lg text-[14px] font-medium text-midnight-600 hover:bg-surface-muted"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={promptInstall}
              className="h-10 flex-1 rounded-lg bg-accent text-[14px] font-semibold text-white"
            >
              Install
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
