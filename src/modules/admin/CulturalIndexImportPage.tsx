import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, Upload } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody, CardHeader } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { useToast } from "@/shared/ui/Toaster";
import { parseCSVWithHeader } from "@/lib/csv";
import { ROLE_LABELS } from "@/types/database";
import {
  ciPreview,
  ciCommit,
  type CiCandidate,
  type CiPreviewResponse,
  type CiRowAnnotated,
  type CiRowInput,
} from "./culturalIndexApi";

// Per-row admin decision: which profile (if any) gets this trait, and whether
// the row is switched on to apply.
interface Decision {
  profileId: string | null;
  apply: boolean;
}

export function CulturalIndexImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [rawText, setRawText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CiPreviewResponse | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [committed, setCommitted] = useState<{ updated: number } | null>(null);

  const previewMut = useMutation({
    mutationFn: (rows: CiRowInput[]) => ciPreview(rows),
    onSuccess: (data) => {
      setPreview(data);
      // Seed decisions: trusted matches on, fuzzy/ambiguous off until confirmed.
      const seed: Record<number, Decision> = {};
      for (const r of data.rows) {
        if (r.match_type === "email" || r.match_type === "name") {
          seed[r.row] = { profileId: r.profile?.id ?? null, apply: true };
        } else {
          seed[r.row] = { profileId: null, apply: false };
        }
      }
      setDecisions(seed);
    },
    onError: (e: unknown) =>
      setParseError(e instanceof Error ? e.message : "Preview failed."),
  });

  const commitMut = useMutation({
    mutationFn: (assignments: { profile_id: string; trait: string }[]) =>
      ciCommit(assignments),
    onSuccess: (data) => {
      setCommitted({ updated: data.updated });
      qc.invalidateQueries({ queryKey: ["gm-roster"] });
      qc.invalidateQueries({ queryKey: ["my-team"] });
      toast.push(
        `Applied ${data.updated} trait${data.updated === 1 ? "" : "s"}.`,
        "success",
      );
    },
    onError: (e: unknown) =>
      setParseError(e instanceof Error ? e.message : "Apply failed."),
  });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => ingest(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  function ingest(text: string) {
    setParseError(null);
    setPreview(null);
    setCommitted(null);
    setRawText(text);
    const rows = parseCSVWithHeader(text).filter((r) =>
      Object.values(r).some((v) => String(v ?? "").trim() !== ""),
    );
    if (rows.length === 0) {
      setParseError("Couldn't parse any rows. Did you include the header row?");
      return;
    }
    const head = rows[0];
    const hasTrait = "trait pattern" in head;
    const hasName = "first name" in head && "last name" in head;
    const hasEmail = "email" in head;
    if (!hasTrait || (!hasName && !hasEmail)) {
      setParseError(
        'This doesn\'t look like a Culture Index export. Expected a "Trait Pattern" column plus "First Name"/"Last Name" (and ideally "Email").',
      );
      return;
    }
    const normalized: CiRowInput[] = rows.map((r) => ({
      first_name: r["first name"] ?? "",
      last_name: r["last name"] ?? "",
      email: r["email"] ?? "",
      trait: r["trait pattern"] ?? "",
      job_title: r["job title"] ?? "",
    }));
    previewMut.mutate(normalized);
  }

  function reset() {
    setRawText("");
    setParseError(null);
    setPreview(null);
    setDecisions({});
    setCommitted(null);
  }

  const setDecision = (row: number, patch: Partial<Decision>) =>
    setDecisions((d) => ({ ...d, [row]: { ...d[row], ...patch } }));

  const assignments = useMemo(() => {
    if (!preview) return [];
    const out: { profile_id: string; trait: string }[] = [];
    for (const r of preview.rows) {
      const d = decisions[r.row];
      if (d?.apply && d.profileId && r.trait) {
        out.push({ profile_id: d.profileId, trait: r.trait });
      }
    }
    return out;
  }, [preview, decisions]);

  return (
    <>
      <PageHeader
        title="Cultural Index import"
        description="Upload the Culture Index survey export to tie each person's trait to their Hub profile. It shows up on the GM Roster and their account."
      />

      {!preview && !committed && (
        <Card>
          <CardHeader title="1. Upload the Culture Index CSV" />
          <CardBody className="space-y-4">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <p className="font-medium text-midnight">How matching works</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-zinc-600">
                <li>Rows are matched to Hub profiles by <b>email</b> first, then by an exact <b>name</b>.</li>
                <li>When a name is only <b>close</b>, we don't guess — you confirm "is this the same person?" before the trait is written.</li>
                <li>Matches every role: GM, DO, SDO, RVP, and up.</li>
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Uses the export's <span className="font-mono">Trait Pattern</span>,{" "}
                <span className="font-mono">First/Last Name</span>, and{" "}
                <span className="font-mono">Email</span> columns.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                Pick CSV file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={onFile}
              />
            </div>

            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                …or paste CSV text
              </label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={5}
                className="mt-1 block w-full rounded-md border-0 bg-white px-3 py-2 font-mono text-xs text-zinc-900 ring-1 ring-inset ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder='"First Name","Last Name","Email",…,"Trait Pattern",…'
              />
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => ingest(rawText)}
                  disabled={!rawText.trim()}
                >
                  Validate pasted text
                </Button>
              </div>
            </div>

            {parseError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {parseError}
              </div>
            )}
            {previewMut.isPending && (
              <p className="text-sm text-zinc-500">Matching against profiles…</p>
            )}
          </CardBody>
        </Card>
      )}

      {preview && !committed && (
        <ReviewTable
          preview={preview}
          decisions={decisions}
          setDecision={setDecision}
          applyCount={assignments.length}
          submitting={commitMut.isPending}
          onCancel={reset}
          onConfirm={() => {
            setParseError(null);
            commitMut.mutate(assignments);
          }}
        />
      )}

      {parseError && preview && !committed && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {parseError}
        </div>
      )}

      {committed && (
        <Card>
          <CardHeader
            title="Done"
            description={`${committed.updated} trait${committed.updated === 1 ? "" : "s"} written to profiles.`}
            actions={
              <Button variant="primary" size="sm" onClick={reset}>
                Import another
              </Button>
            }
          />
          <CardBody>
            <p className="text-sm text-zinc-600">
              Traits now show on the{" "}
              <a href="/admin/gm-roster" className="font-medium text-accent underline">
                GM Roster
              </a>{" "}
              and each person's My Account page.
            </p>
          </CardBody>
        </Card>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Review — trusted matches pre-checked; close names ask for confirmation.
// ----------------------------------------------------------------------------

function ReviewTable({
  preview,
  decisions,
  setDecision,
  applyCount,
  submitting,
  onCancel,
  onConfirm,
}: {
  preview: CiPreviewResponse;
  decisions: Record<number, Decision>;
  setDecision: (row: number, patch: Partial<Decision>) => void;
  applyCount: number;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { rows, summary } = preview;
  const needsAttention = rows.filter((r) => r.needs_confirm);
  const trusted = rows.filter(
    (r) => r.match_type === "email" || r.match_type === "name",
  );
  const skipped = rows.filter(
    (r) => r.match_type === "none" || r.match_type === "no_trait",
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="2. Review & confirm"
          description={`${summary.email + summary.name} auto-matched · ${summary.fuzzy + summary.ambiguous} need confirmation · ${summary.none} no match · ${summary.no_trait} no trait`}
          actions={
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Start over
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={onConfirm}
                disabled={submitting || applyCount === 0}
              >
                {submitting ? "Applying…" : `Apply ${applyCount} trait${applyCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          }
        />
      </Card>

      {/* Needs confirmation — close-name matches. */}
      {needsAttention.length > 0 && (
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-amber-600" strokeWidth={2} />
                Is this the same person? ({needsAttention.length})
              </span>
            }
            description="We found a close name but couldn't confirm it. Pick the matching person to write their trait, or leave it as “Not a match”."
          />
          <CardBody className="space-y-3 p-4">
            {needsAttention.map((r) => (
              <ConfirmRow
                key={r.row}
                row={r}
                decision={decisions[r.row]}
                onPick={(profileId) =>
                  setDecision(r.row, {
                    profileId,
                    apply: profileId !== null,
                  })
                }
              />
            ))}
          </CardBody>
        </Card>
      )}

      {/* Auto-matched. */}
      {trusted.length > 0 && (
        <Card>
          <CardHeader
            title={`Auto-matched (${trusted.length})`}
            description="Matched by email or exact name. Uncheck any you don't want to write."
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Apply</th>
                    <th className="px-3 py-2 font-medium">Survey person</th>
                    <th className="px-3 py-2 font-medium">Trait</th>
                    <th className="px-3 py-2 font-medium">Hub profile</th>
                    <th className="px-3 py-2 font-medium">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {trusted.map((r) => {
                    const d = decisions[r.row];
                    const overwrite =
                      r.profile?.current_trait &&
                      r.profile.current_trait.toLowerCase() !== r.trait.toLowerCase();
                    return (
                      <tr key={r.row}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={!!d?.apply}
                            onChange={(e) =>
                              setDecision(r.row, { apply: e.target.checked })
                            }
                            className="h-4 w-4 accent-accent"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-zinc-800">
                            {r.first_name} {r.last_name}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {r.email || "—"}
                            {r.job_title ? ` · ${r.job_title}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone="info">{r.trait}</Badge>
                          {overwrite && (
                            <div className="mt-0.5 text-[11px] text-amber-700">
                              replaces “{r.profile?.current_trait}”
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.profile ? (
                            <>
                              <div className="text-zinc-800">{r.profile.name}</div>
                              <div className="text-xs text-zinc-500">
                                {ROLE_LABELS[r.profile.role]}
                              </div>
                            </>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={r.match_type === "email" ? "success" : "neutral"}>
                            {r.match_type === "email" ? "Email" : "Name"}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Skipped — no match / no trait. */}
      {skipped.length > 0 && (
        <Card>
          <CardHeader
            title={`Skipped (${skipped.length})`}
            description="No profile to attach these to. They're left untouched."
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-zinc-100">
                  {skipped.map((r) => (
                    <tr key={r.row} className="text-zinc-500">
                      <td className="px-3 py-2">
                        {r.first_name} {r.last_name}
                        <span className="ml-2 text-xs">{r.email}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.trait ? <Badge tone="neutral">{r.trait}</Badge> : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.match_type === "no_trait"
                          ? "No trait in this row"
                          : "No matching profile"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// A single close-name row: the survey person + a radio list of candidate
// profiles ("is this the same person?") plus a "Not a match" option.
function ConfirmRow({
  row,
  decision,
  onPick,
}: {
  row: CiRowAnnotated;
  decision: Decision | undefined;
  onPick: (profileId: string | null) => void;
}) {
  const picked = decision?.profileId ?? null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-zinc-800">
            {row.first_name} {row.last_name}
          </span>
          {row.email && <span className="ml-2 text-xs text-zinc-500">{row.email}</span>}
          {row.job_title && (
            <span className="ml-2 text-xs text-zinc-500">· {row.job_title}</span>
          )}
        </div>
        <Badge tone="info">{row.trait}</Badge>
      </div>
      <p className="mt-2 text-xs font-medium text-zinc-600">Is this the same person?</p>
      <div className="mt-1 space-y-1">
        {row.candidates.map((c: CiCandidate) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white"
          >
            <input
              type="radio"
              name={`ci-confirm-${row.row}`}
              checked={picked === c.id}
              onChange={() => onPick(c.id)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-zinc-800">{c.name}</span>
            <Badge tone="neutral">{ROLE_LABELS[c.role]}</Badge>
            {c.email && <span className="text-xs text-zinc-400">{c.email}</span>}
            {c.has_trait && (
              <span className="text-[11px] text-amber-700">
                already: {c.current_trait}
              </span>
            )}
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white">
          <input
            type="radio"
            name={`ci-confirm-${row.row}`}
            checked={picked === null}
            onChange={() => onPick(null)}
            className="h-4 w-4 accent-accent"
          />
          <span className="text-zinc-500">Not a match — skip</span>
        </label>
      </div>
    </div>
  );
}
