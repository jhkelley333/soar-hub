// Review tab — read-only summary view of the scope. Useful for DOs
// reviewing a submission and for the scoper to see what's still missing
// before they submit. The big "Export PDF" button at the top runs the
// jspdf pipeline in pdf.ts.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Star,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import {
  fetchPhotoSlots,
  fetchScopeItems,
  fetchScopePhotos,
  fetchTemplateItems,
} from "./api";
import { exportScopePdf } from "./pdf";
import {
  TIER_LABELS,
  TIER_ORDER,
  itemRequiredForBuilding,
  type RenoScopeItem,
  type RenoScopePhoto,
  type RenoScopeRow,
  type ScopePhotoSlot,
  type ScopeTemplateItem,
  type ScopeTier,
} from "./types";

interface Props {
  scope: RenoScopeRow;
}

export function ReviewTab({ scope }: Props) {
  const itemsQuery = useQuery({
    queryKey: ["reno-template-items", scope.template_id],
    queryFn: () => fetchTemplateItems(scope.template_id),
    staleTime: 5 * 60_000,
  });
  const answersQuery = useQuery({
    queryKey: ["reno-scope-items", scope.id],
    queryFn: () => fetchScopeItems(scope.id),
  });
  const slotsQuery = useQuery({
    queryKey: ["reno-photo-slots", scope.template_id],
    queryFn: () => fetchPhotoSlots(scope.template_id),
    staleTime: 5 * 60_000,
  });
  const photosQuery = useQuery({
    queryKey: ["reno-scope-photos", scope.id],
    queryFn: () => fetchScopePhotos(scope.id),
  });

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const items = itemsQuery.data ?? [];
  const answers = answersQuery.data ?? [];
  const slots = slotsQuery.data ?? [];
  const photos = photosQuery.data ?? [];

  const summary = useMemo(
    () => buildSummary(items, answers, slots, photos, scope),
    [items, answers, slots, photos, scope],
  );

  async function onExport() {
    setExporting(true);
    setExportError(null);
    try {
      await exportScopePdf(scope);
    } catch (err) {
      setExportError((err as Error)?.message ?? "PDF export failed.");
    } finally {
      setExporting(false);
    }
  }

  if (
    itemsQuery.isLoading ||
    answersQuery.isLoading ||
    slotsQuery.isLoading ||
    photosQuery.isLoading
  ) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-midnight">Scope summary</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Read-only roll-up. Use the Checklist tab to edit items.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <Button onClick={onExport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Download className="h-4 w-4" strokeWidth={2} />
              )}
              {exporting ? "Building PDF…" : "Export PDF"}
            </Button>
            {exportError && (
              <p className="text-[11px] text-red-600">{exportError}</p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-3 p-4">
          <h3 className="text-sm font-semibold text-midnight">Readiness</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Required items"
              value={`${summary.requiredAnswered} / ${summary.requiredTotal}`}
              tone={summary.requiredAnswered === summary.requiredTotal ? "success" : "warning"}
            />
            <Stat
              label="Required photos"
              value={`${summary.requiredPhotosFilled} / ${summary.requiredPhotosTotal}`}
              tone={summary.requiredPhotosFilled === summary.requiredPhotosTotal ? "success" : "warning"}
            />
            <Stat
              label="Estimated cost"
              value={
                summary.totalCost > 0
                  ? `$${summary.totalCost.toLocaleString()}`
                  : "—"
              }
              tone="neutral"
            />
          </div>
          {summary.blockers.length > 0 && (
            <div className="rounded-md bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
                Before submitting
              </p>
              <ul className="mt-1 list-inside list-disc text-xs text-amber-900">
                {summary.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.blockers.length === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              Required items + photos complete. Ready to submit.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-2 p-4">
          <h3 className="text-sm font-semibold text-midnight">Per-tier breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-500">
                  <th className="py-1.5 pr-3 font-medium">Tier</th>
                  <th className="py-1.5 pr-3 font-medium">Answered</th>
                  <th className="py-1.5 pr-3 font-medium">Pass</th>
                  <th className="py-1.5 pr-3 font-medium">Fail</th>
                  <th className="py-1.5 pr-3 font-medium">Needs work</th>
                  <th className="py-1.5 pr-3 font-medium">N/A</th>
                  <th className="py-1.5 pr-3 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.map((tier) => {
                  const t = summary.tierCounts[tier];
                  if (!t || t.total === 0) return null;
                  return (
                    <tr key={tier} className="border-b border-zinc-100">
                      <td className="py-1.5 pr-3 font-medium text-midnight">{TIER_LABELS[tier]}</td>
                      <td className="py-1.5 pr-3 text-zinc-700">{t.answered} / {t.total}</td>
                      <td className="py-1.5 pr-3 text-green-700">{t.pass || ""}</td>
                      <td className="py-1.5 pr-3 text-red-700">{t.fail || ""}</td>
                      <td className="py-1.5 pr-3 text-amber-800">{t.needs_work || ""}</td>
                      <td className="py-1.5 pr-3 text-zinc-500">{t.na || ""}</td>
                      <td className="py-1.5 pr-3 text-zinc-700">
                        {t.cost > 0 ? `$${t.cost.toLocaleString()}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-2 p-4">
          <h3 className="text-sm font-semibold text-midnight">Required photos</h3>
          {summary.requiredPhotosTotal === 0 ? (
            <p className="text-xs text-zinc-500">No required photos defined for this template.</p>
          ) : (
            <ul className="space-y-1">
              {summary.requiredPhotoStatus.map((row) => (
                <li key={row.slot.id} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-700">{row.slot.slot_name}</span>
                  {row.filled ? (
                    <Badge tone="success">✓</Badge>
                  ) : (
                    <Badge tone="warning">Missing</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {summary.recommendedPlusUps.length > 0 && (
        <Card>
          <div className="space-y-2 p-4">
            <h3 className="text-sm font-semibold text-midnight">Recommended plus-ups + optionals</h3>
            <ul className="space-y-1">
              {summary.recommendedPlusUps.map((it) => (
                <li key={it.id} className="flex items-start gap-2 text-xs">
                  <Star
                    className="mt-0.5 h-3 w-3 shrink-0 fill-amber-400 text-amber-500"
                    strokeWidth={2}
                  />
                  <span className="text-zinc-700">
                    <span className="text-zinc-400">#{it.sort_order}</span> {it.item_label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "neutral";
}) {
  const cls =
    tone === "success"
      ? "ring-green-200 bg-green-50 text-green-800"
      : tone === "warning"
      ? "ring-amber-200 bg-amber-50 text-amber-900"
      : "ring-zinc-200 bg-white text-midnight";
  return (
    <div className={`rounded-md px-3 py-2 ring-1 ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

// ---- summary computation ---------------------------------------------

interface TierRollup {
  total: number;
  answered: number;
  pass: number;
  fail: number;
  needs_work: number;
  na: number;
  cost: number;
}

interface Summary {
  requiredTotal: number;
  requiredAnswered: number;
  requiredPhotosTotal: number;
  requiredPhotosFilled: number;
  requiredPhotoStatus: { slot: ScopePhotoSlot; filled: boolean }[];
  totalCost: number;
  blockers: string[];
  tierCounts: Partial<Record<ScopeTier, TierRollup>>;
  recommendedPlusUps: ScopeTemplateItem[];
}

function buildSummary(
  items: ScopeTemplateItem[],
  answers: RenoScopeItem[],
  slots: ScopePhotoSlot[],
  photos: RenoScopePhoto[],
  scope: RenoScopeRow,
): Summary {
  const answerById: Record<string, RenoScopeItem> = {};
  for (const a of answers) answerById[a.template_item_id] = a;

  const photoBySlot = new Set<string>();
  for (const p of photos) {
    if (p.photo_slot_id) photoBySlot.add(p.photo_slot_id);
  }

  const tierCounts: Partial<Record<ScopeTier, TierRollup>> = {};
  let requiredTotal = 0;
  let requiredAnswered = 0;
  let totalCost = 0;
  const recommendedPlusUps: ScopeTemplateItem[] = [];

  for (const it of items) {
    if (!it.applies_to_building_types.includes(scope.building_type)) continue;
    const r =
      (tierCounts[it.tier] = tierCounts[it.tier] ?? {
        total: 0,
        answered: 0,
        pass: 0,
        fail: 0,
        needs_work: 0,
        na: 0,
        cost: 0,
      });
    r.total += 1;
    const a = answerById[it.id];
    if (a?.status) {
      r.answered += 1;
      r[a.status] += 1;
    }
    if (a?.estimated_cost) {
      const n = Number(a.estimated_cost);
      if (Number.isFinite(n)) {
        r.cost += n;
        totalCost += n;
      }
    }
    if (itemRequiredForBuilding(it, scope.building_type)) {
      requiredTotal += 1;
      if (a?.status) requiredAnswered += 1;
    }
    if ((it.tier === "plus_up" || it.tier === "optional") && a?.recommend_for_plus_up) {
      recommendedPlusUps.push(it);
    }
  }
  recommendedPlusUps.sort((a, b) => a.sort_order - b.sort_order);

  const requiredSlots = slots
    .filter((s) => s.is_required)
    .sort((a, b) => a.sort_order - b.sort_order);
  const requiredPhotoStatus = requiredSlots.map((slot) => ({
    slot,
    filled: photoBySlot.has(slot.id),
  }));
  const requiredPhotosTotal = requiredSlots.length;
  const requiredPhotosFilled = requiredPhotoStatus.filter((r) => r.filled).length;

  const blockers: string[] = [];
  if (requiredAnswered < requiredTotal) {
    blockers.push(
      `${requiredTotal - requiredAnswered} required item${
        requiredTotal - requiredAnswered === 1 ? "" : "s"
      } still need a status.`,
    );
  }
  if (requiredPhotosFilled < requiredPhotosTotal) {
    blockers.push(
      `${requiredPhotosTotal - requiredPhotosFilled} required photo${
        requiredPhotosTotal - requiredPhotosFilled === 1 ? "" : "s"
      } still missing.`,
    );
  }

  return {
    requiredTotal,
    requiredAnswered,
    requiredPhotosTotal,
    requiredPhotosFilled,
    requiredPhotoStatus,
    totalCost,
    blockers,
    tierCounts,
    recommendedPlusUps,
  };
}
