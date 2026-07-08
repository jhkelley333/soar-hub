// Phone side of the Command Center photo handoff (/p/:token). The store's
// desktop shows a QR with a short-lived signed token; the crew scans it and
// this mobile page uploads photos straight onto that work order. No login —
// the token is the credential, verified server-side, ~20 minute life.
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, ImagePlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { fetchPhoneInfo, uploadPhonePhoto } from "./api";

type Item = { name: string; status: "uploading" | "done" | "error"; error?: string };

export function PhoneUploadPage() {
  const { token = "" } = useParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const info = useQuery({ queryKey: ["phone-info", token], queryFn: () => fetchPhoneInfo(token), enabled: !!token, retry: false });

  const pick = () => fileRef.current?.click();
  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      setItems((prev) => [...prev, { name: file.name, status: "uploading" }]);
      try {
        await uploadPhonePhoto(token, file);
        setItems((prev) => prev.map((it) => (it.name === file.name && it.status === "uploading" ? { ...it, status: "done" } : it)));
      } catch (e) {
        setItems((prev) => prev.map((it) => (it.name === file.name && it.status === "uploading"
          ? { ...it, status: "error", error: (e as Error)?.message ?? "Upload failed" } : it)));
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const done = items.filter((i) => i.status === "done").length;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <header className="border-b border-zinc-100 bg-white px-5 py-4">
        <div className="text-xl font-extrabold tracking-tight">my<span className="text-red-600">soar</span>hub</div>
      </header>

      <main className="mx-auto max-w-md px-5 py-8">
        {info.isError ? (
          <div className="flex flex-col items-center pt-16 text-center">
            <AlertTriangle className="h-10 w-10 text-red-500" />
            <h1 className="mt-4 text-xl font-bold">This code isn't valid</h1>
            <p className="mt-2 text-zinc-500">{(info.error as Error)?.message ?? "Ask the store screen for a fresh QR code."}</p>
          </div>
        ) : info.isLoading ? (
          <div className="pt-16 text-center text-zinc-400">Checking the code…</div>
        ) : (
          <>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-600">Add photos</div>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
              <span className="font-mono">{info.data!.wo_number}</span>
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Store #{info.data!.store_number}{info.data!.store_name ? ` · ${info.data!.store_name}` : ""}
            </p>
            {info.data!.issue_description && (
              <p className="mt-3 rounded-xl bg-white p-3 text-[15px] leading-snug text-zinc-700 shadow-sm">{info.data!.issue_description}</p>
            )}

            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden
              onChange={(e) => onFiles(e.target.files)} />
            <button onClick={pick} disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-5 text-lg font-bold text-white shadow-lg shadow-red-600/25 transition active:scale-[0.99] disabled:opacity-50">
              {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
              {busy ? "Uploading…" : items.length ? "Add more photos" : "Take / choose photos"}
            </button>
            <p className="mt-2 text-center text-xs text-zinc-400">Up to {info.data!.max_photos} photos · 5 MB each</p>

            {items.length > 0 && (
              <ul className="mt-6 flex flex-col gap-2">
                {items.map((it, i) => (
                  <li key={i} className={cn("flex items-center gap-2.5 rounded-xl bg-white px-4 py-3 text-sm shadow-sm",
                    it.status === "error" && "ring-1 ring-red-200")}>
                    {it.status === "uploading" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />}
                    {it.status === "done" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                    {it.status === "error" && <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
                    <span className="min-w-0 flex-1 truncate text-zinc-700">{it.name}</span>
                    {it.status === "error" && <span className="shrink-0 text-xs font-medium text-red-600">{it.error}</span>}
                  </li>
                ))}
              </ul>
            )}

            {done > 0 && !busy && (
              <div className="mt-6 flex items-center gap-2.5 rounded-2xl bg-emerald-50 px-4 py-4 text-emerald-800">
                <ImagePlus className="h-5 w-5 shrink-0" />
                <p className="text-sm font-semibold">
                  {done} photo{done === 1 ? "" : "s"} on the ticket — they're already showing on the store screen. You can close this page.
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
