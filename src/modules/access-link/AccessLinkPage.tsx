// Public "stay logged in" landing page. Opening /go/<token> asks the server for
// a fresh one-time login for the bound profile, verifies it into a real
// Supabase session on this device, and redirects into the app. The device then
// stays logged in normally (refresh tokens) until the token is revoked.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/access-link";

export function AccessLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        // If a session already exists on this device, just go straight in.
        const { data: existing } = await supabase.auth.getSession();
        if (existing.session) {
          window.location.replace("/");
          return;
        }
        const res = await fetch(`${FN}?action=login&token=${encodeURIComponent(token || "")}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.email || !body?.otp) {
          throw new Error(body?.error || "This link could not sign you in.");
        }
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          email: body.email,
          token: body.otp,
          type: "email",
        });
        if (verifyErr) throw verifyErr;
        window.location.replace("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "This link could not sign you in.");
      }
    })();
  }, [token]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        {error ? (
          <>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Can't sign in</h1>
            <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.5 }}>{error}</p>
            <a
              href="/login"
              style={{
                display: "inline-block",
                marginTop: 20,
                padding: "10px 18px",
                borderRadius: 8,
                background: "#2563eb",
                color: "white",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Go to sign in
            </a>
          </>
        ) : (
          <>
            <div
              style={{
                width: 40,
                height: 40,
                margin: "0 auto 16px",
                border: "3px solid #334155",
                borderTopColor: "#38bdf8",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <p style={{ fontSize: 15, color: "#cbd5e1" }}>Signing you in…</p>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </>
        )}
      </div>
    </div>
  );
}
