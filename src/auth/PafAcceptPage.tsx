// Public landing page for the 72-hour PAF approval link. Token is
// validated server-side and the PAF flips to Approved on success.
// Anyone with the link can click — that's the whole point.

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { tokenApprovePaf } from "@/modules/paf/api";

type Status = "loading" | "success" | "expired" | "invalid" | "wait";

export function PafAcceptPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<Status>(token ? "wait" : "invalid");
  const [employee, setEmployee] = useState<string>("");
  const [store, setStore] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) setStatus("invalid");
  }, [token]);

  async function approve() {
    if (!token || submitting) return;
    setSubmitting(true);
    setStatus("loading");
    try {
      const res = await tokenApprovePaf(token);
      setEmployee(res.employee_name);
      setStore(res.drive_in);
      setStatus("success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed.";
      setErrorMsg(msg);
      if (msg.toLowerCase().includes("expired")) setStatus("expired");
      else setStatus("invalid");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-accent px-4 py-12 text-white">
      <div className="relative w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-white/80">
            SOAR QSR
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            PAF Approval
          </h1>
        </div>
        <div className="rounded-xl bg-white p-6 text-zinc-900 shadow-2xl ring-1 ring-black/5">
          {status === "wait" && (
            <>
              <h2 className="text-base font-semibold tracking-tight text-midnight">
                Confirm approval
              </h2>
              <p className="mt-2 text-sm text-zinc-600">
                Click the button below to approve this PAF. The link is single-
                use and will not work again afterward.
              </p>
              <button
                type="button"
                onClick={approve}
                disabled={submitting}
                className="mt-4 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
              >
                Approve PAF
              </button>
            </>
          )}
          {status === "loading" && (
            <p className="text-sm text-zinc-600">Approving…</p>
          )}
          {status === "success" && (
            <>
              <h2 className="text-base font-semibold text-emerald-700">
                Approved ✓
              </h2>
              <p className="mt-2 text-sm text-zinc-700">
                The PAF for <strong>{employee}</strong> at store{" "}
                <strong>#{store}</strong> has been approved. Payroll will be
                notified. You can close this window.
              </p>
            </>
          )}
          {status === "expired" && (
            <>
              <h2 className="text-base font-semibold text-amber-700">
                Link expired
              </h2>
              <p className="mt-2 text-sm text-zinc-700">
                This approval link has expired. Ask Payroll to resend.
              </p>
            </>
          )}
          {status === "invalid" && (
            <>
              <h2 className="text-base font-semibold text-red-700">
                Invalid link
              </h2>
              <p className="mt-2 text-sm text-zinc-700">
                {errorMsg || "This link is invalid or already used."}
              </p>
            </>
          )}
          <div className="mt-6 text-center">
            <Link
              to="/"
              className="text-xs font-medium text-zinc-500 hover:text-midnight"
            >
              Back to SOAR Hub
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
