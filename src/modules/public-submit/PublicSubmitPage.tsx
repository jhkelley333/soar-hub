// Public, unauthenticated ticket-submission page mounted at /submit.
// Anyone with the URL can:
//   1. Search for a store by number or name (typeahead, debounced)
//   2. Enter their name + email (required) and phone (optional)
//   3. Pick a category + priority and describe the issue
//   4. Submit and see the WO number on the confirmation card
//
// No file uploads yet — keeps the storage-abuse surface at zero.
// Photos can be added in a follow-up if usage justifies it.

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MapPin, Search, Wrench } from "lucide-react";
import { Button } from "@/shared/ui/Button";
import { Card, CardBody } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { cn } from "@/lib/cn";

const FN = "/.netlify/functions/public-submit";

interface StoreHit {
  id: string;
  number: string;
  name: string | null;
}

interface SubmitResult {
  wo_number: string;
  store_number: string;
  store_name: string | null;
}

const CATEGORIES = [
  "Facilities & Infrastructure",
  "Equipment / Cooking",
  "Refrigeration",
  "HVAC",
  "Plumbing",
  "Electrical",
  "POS / Tech",
  "Beverage",
  "Other",
];

export function PublicSubmitPage() {
  const [storeQuery, setStoreQuery] = useState("");
  const [storeHits, setStoreHits] = useState<StoreHit[]>([]);
  const [storeSearchOpen, setStoreSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pickedStore, setPickedStore] = useState<StoreHit | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [assetType, setAssetType] = useState("");
  const [priority, setPriority] = useState<"Standard" | "Urgent" | "Emergency">("Standard");
  const [issueDescription, setIssueDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Debounced store typeahead. 250ms feels snappy without flogging
  // the function on every keystroke.
  useEffect(() => {
    if (pickedStore) return; // user already picked, don't keep searching
    const q = storeQuery.trim();
    if (q.length < 2) {
      setStoreHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${FN}?action=searchStores&q=${encodeURIComponent(q)}`);
        const body = await res.json().catch(() => ({}));
        if (body.ok && Array.isArray(body.stores)) {
          setStoreHits(body.stores);
        } else {
          setStoreHits([]);
        }
      } catch {
        setStoreHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [storeQuery, pickedStore]);

  const canSubmit =
    !!pickedStore
    && name.trim().length > 0
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    && issueDescription.trim().length >= 10
    && !submitting;

  async function submit() {
    if (!pickedStore) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${FN}?action=createTicket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: pickedStore.id,
          submitter_name: name.trim(),
          submitter_email: email.trim(),
          submitter_phone: phone.trim(),
          category,
          asset_type: assetType.trim(),
          issue_description: issueDescription.trim(),
          priority,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.message || `Submit failed (${res.status}).`);
      }
      setResult(body.ticket);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2 text-base font-semibold tracking-tight text-midnight">
          <Wrench className="h-5 w-5 text-accent" strokeWidth={2} />
          SOAR — Submit a Work Order
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-24">
        {result ? (
          <Card>
            <CardBody className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
                <div className="text-base font-semibold">Submitted</div>
              </div>
              <p className="text-sm text-zinc-700">
                Your ticket has been filed. The store and our facilities team have been notified.
              </p>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                <div>
                  <span className="text-zinc-500">Work order:</span>{" "}
                  <span className="font-mono font-semibold text-midnight">{result.wo_number}</span>
                </div>
                <div className="mt-1">
                  <span className="text-zinc-500">Store:</span>{" "}
                  <span className="font-medium text-midnight">#{result.store_number}{result.store_name ? ` · ${result.store_name}` : ""}</span>
                </div>
              </div>
              <p className="text-xs text-zinc-500">
                Save your work order number for reference. To submit another, refresh this page.
              </p>
            </CardBody>
          </Card>
        ) : (
          <>
            <Card>
              <CardBody className="space-y-3">
                <div>
                  <Label htmlFor="ps-store">Which store?</Label>
                  {pickedStore ? (
                    <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2">
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-accent" strokeWidth={1.75} />
                        <span className="font-semibold text-midnight">#{pickedStore.number}</span>
                        {pickedStore.name && (
                          <span className="text-zinc-600">· {pickedStore.name}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedStore(null);
                          setStoreQuery("");
                          setStoreHits([]);
                          setStoreSearchOpen(true);
                        }}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400">
                        <Search className="h-4 w-4" strokeWidth={1.75} />
                      </div>
                      <Input
                        id="ps-store"
                        value={storeQuery}
                        onChange={(e) => {
                          setStoreQuery(e.target.value);
                          setStoreSearchOpen(true);
                        }}
                        onFocus={() => setStoreSearchOpen(true)}
                        placeholder="Search by store number or name…"
                        className="pl-8"
                        autoComplete="off"
                      />
                      {storeSearchOpen && storeQuery.trim().length >= 2 && (
                        <div className="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg">
                          {searching && (
                            <div className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-500">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Searching…
                            </div>
                          )}
                          {!searching && storeHits.length === 0 && (
                            <div className="px-3 py-2 text-xs text-zinc-500">No stores match.</div>
                          )}
                          {storeHits.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                setPickedStore(s);
                                setStoreSearchOpen(false);
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                            >
                              <span className="font-semibold text-midnight">#{s.number}</span>
                              {s.name && <span className="ml-2 text-zinc-600">{s.name}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <div className="text-sm font-semibold tracking-tight text-midnight">Your contact info</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ps-name">Name</Label>
                    <Input
                      id="ps-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Doe"
                    />
                  </div>
                  <div>
                    <Label htmlFor="ps-email">Email</Label>
                    <Input
                      id="ps-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@example.com"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ps-phone">Phone (optional)</Label>
                    <Input
                      id="ps-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="555-555-1234"
                    />
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="space-y-3">
                <div className="text-sm font-semibold tracking-tight text-midnight">What's the issue?</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ps-category">Category</Label>
                    <select
                      id="ps-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="">— Pick a category —</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="ps-asset">Equipment / asset (optional)</Label>
                    <Input
                      id="ps-asset"
                      value={assetType}
                      onChange={(e) => setAssetType(e.target.value)}
                      placeholder="Walk-in freezer, hood, ice machine, ..."
                    />
                  </div>
                </div>
                <div>
                  <Label>Priority</Label>
                  <div className="flex gap-2">
                    {(["Standard", "Urgent", "Emergency"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={cn(
                          "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition",
                          priority === p
                            ? p === "Emergency" ? "border-red-500 bg-red-50 text-red-800"
                            : p === "Urgent"   ? "border-amber-500 bg-amber-50 text-amber-900"
                            : "border-accent bg-accent/10 text-midnight"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                        )}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="ps-desc">Describe the issue</Label>
                  <textarea
                    id="ps-desc"
                    value={issueDescription}
                    onChange={(e) => setIssueDescription(e.target.value)}
                    rows={4}
                    minLength={10}
                    className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="What's wrong, where exactly, when did it start, any error codes or symptoms..."
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Minimum 10 characters. The clearer the description, the faster we can route it.
                  </div>
                </div>
              </CardBody>
            </Card>

            {submitError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-[11px] text-zinc-500">
                By submitting, you confirm the info above is accurate. The store will be notified.
              </div>
              <Button variant="primary" onClick={submit} disabled={!canSubmit}>
                {submitting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Submit work order
              </Button>
            </div>
          </>
        )}

        <div className="pt-2 text-center text-[10px] uppercase tracking-wide text-zinc-400">
          Powered by SOAR Operations Hub
        </div>
      </main>
    </div>
  );
}
