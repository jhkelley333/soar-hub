// Pre-Con section that lives at the top of the Pre-Con tab. Captures
// every data point the GC needs from a pre-reskin visit, grouped into
// cards:
//
//   1. Stall data           — patio POP / OA stalls / trailer (stores.*)
//   2. Site features        — stall canopy / clearance bar / DT order
//                             canopy presence + condition (mixed
//                             stores.* + reno_scopes.*)
//   3. Demolition inventory — counts of items to remove (reno_scopes.*)
//   4. Bollards             — count, repair count, notes (reno_scopes.*)
//   5. Surface conditions   — rust, stucco/EIFS, nichiha, doghouse
//                             (reno_scopes.*)
//   6. Existing signage     — pylon condition (reno_scopes.*)
//   7. Site notes           — dumpster enclosure ready, drainage notes
//                             (reno_scopes.*)
//   8. Damaged OA signs     — count + notes (reno_scopes.*)
//
// stores.* writes flow through the reno-scoping netlify function so the
// scope owner can edit canonical store data despite RLS being admin-only
// at the table level. reno_scopes.* writes go straight to supabase
// (RLS allows scoper on draft / needs_revision and DO+ on anything
// visible).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  Check,
  Eraser,
  Hammer,
  Loader2,
  Megaphone,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import { Card } from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Skeleton } from "@/shared/ui/Skeleton";
import { cn } from "@/lib/cn";
import {
  fetchStoreStallAttributes,
  updateScopeDamage,
  updateScopePreCon,
  updateScopeStoreAttributes,
  type PreConFindingsPatch,
} from "./api";
import type {
  DoghouseDisposition,
  DtOrderCanopyCondition,
  PylonSignCondition,
  RenoScope,
  StallCanopyCondition,
  SteelRustSeverity,
  StoreStallAttributes,
  StuccoEifsCondition,
} from "./types";

interface Props {
  scope: RenoScope & { store_id: string };
  canEdit: boolean;
}

const ATTRIBUTE_QUERY_KEY = (storeId: string) => ["store-stall-attributes", storeId];

export function PreConSection({ scope, canEdit }: Props) {
  const queryClient = useQueryClient();
  const attrsQuery = useQuery({
    queryKey: ATTRIBUTE_QUERY_KEY(scope.store_id),
    queryFn: () => fetchStoreStallAttributes(scope.store_id),
    staleTime: 30_000,
  });

  // Shared mutations across all the reno_scopes-side cards. Each card
  // mutates against the same scope row; centralizing the mutation
  // lets the saving / saved status pill be shared (less visual noise
  // than 6 separate "Saved" indicators on a single page).
  const preConMutation = useMutation({
    mutationFn: (patch: PreConFindingsPatch) => updateScopePreCon(scope.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope", scope.id] });
    },
  });

  const damageMutation = useMutation({
    mutationFn: (patch: {
      damaged_oa_signs_count?: number;
      damaged_oa_signs_notes?: string | null;
    }) => updateScopeDamage(scope.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reno-scope", scope.id] });
    },
  });

  if (attrsQuery.isLoading || !attrsQuery.data) {
    return (
      <Card>
        <div className="p-4">
          <Skeleton className="h-32 w-full" />
        </div>
      </Card>
    );
  }
  if (attrsQuery.isError) {
    return (
      <Card>
        <div className="flex items-start gap-2 p-3 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span>
            Couldn't load store attributes:{" "}
            {(attrsQuery.error as Error)?.message ?? "Unknown error"}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <StallDataCard scope={scope} attrs={attrsQuery.data} canEdit={canEdit} />
      <SiteFeaturesCard
        scope={scope}
        attrs={attrsQuery.data}
        canEdit={canEdit}
        preConMutation={preConMutation}
      />
      <DemolitionInventoryCard
        scope={scope}
        canEdit={canEdit}
        mutation={preConMutation}
      />
      <BollardsCard scope={scope} canEdit={canEdit} mutation={preConMutation} />
      <SurfaceConditionsCard
        scope={scope}
        canEdit={canEdit}
        mutation={preConMutation}
      />
      <ExistingSignageCard
        scope={scope}
        canEdit={canEdit}
        mutation={preConMutation}
      />
      <SiteNotesCard scope={scope} canEdit={canEdit} mutation={preConMutation} />
      <DamagedSignsCard scope={scope} canEdit={canEdit} mutation={damageMutation} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// 1. Stall data (existing — stores.*)
// ----------------------------------------------------------------------------

function StallDataCard({
  scope,
  attrs,
  canEdit,
}: {
  scope: { id: string; store_id: string };
  attrs: StoreStallAttributes;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<StoreStallAttributes>(attrs);
  useEffect(() => setDraft(attrs), [attrs]);

  const mutation = useMutation({
    mutationFn: (patch: Partial<StoreStallAttributes>) =>
      updateScopeStoreAttributes(scope.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTRIBUTE_QUERY_KEY(scope.store_id) });
    },
  });

  function patch<K extends keyof StoreStallAttributes>(
    key: K,
    value: StoreStallAttributes[K],
  ) {
    setDraft({ ...draft, [key]: value });
  }
  function commit<K extends keyof StoreStallAttributes>(key: K) {
    if (draft[key] === attrs[key]) return;
    mutation.mutate({ [key]: draft[key] } as Partial<StoreStallAttributes>);
  }

  return (
    <CardWithHeader
      icon={Building2}
      title="Stall data"
      subtitle="Captured at the visit. Saves back to the canonical store record."
      mutation={mutation}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <NumField
          id="patio-pop-count"
          label="# Patio POP menus"
          value={draft.patio_pop_menu_count}
          disabled={!canEdit}
          onChange={(v) => patch("patio_pop_menu_count", v)}
          onBlur={() => commit("patio_pop_menu_count")}
        />
        <TextField
          id="patio-pop-stalls"
          label="Patio POP stall #s"
          placeholder="e.g. 1,2,3,4"
          value={draft.patio_pop_stall_numbers ?? ""}
          disabled={!canEdit}
          onChange={(v) => patch("patio_pop_stall_numbers", v || null)}
          onBlur={() => commit("patio_pop_stall_numbers")}
        />
        <NumField
          id="oa-stall-count"
          label="# Order Ahead stalls"
          value={draft.order_ahead_stall_count}
          disabled={!canEdit}
          onChange={(v) => patch("order_ahead_stall_count", v)}
          onBlur={() => commit("order_ahead_stall_count")}
        />
        <TextField
          id="oa-stalls"
          label="Order Ahead stall #s"
          placeholder="e.g. 5,6"
          value={draft.order_ahead_stall_numbers ?? ""}
          disabled={!canEdit}
          onChange={(v) => patch("order_ahead_stall_numbers", v || null)}
          onBlur={() => commit("order_ahead_stall_numbers")}
        />
        <NumField
          id="stall-pop-count"
          label="# Stall POP menus"
          value={draft.stall_pop_menu_count}
          disabled={!canEdit}
          onChange={(v) => patch("stall_pop_menu_count", v)}
          onBlur={() => commit("stall_pop_menu_count")}
        />
        <TextField
          id="stall-pop-stalls"
          label="Stall POP stall #s"
          placeholder="e.g. 1,2,5"
          value={draft.stall_pop_stall_numbers ?? ""}
          disabled={!canEdit}
          onChange={(v) => patch("stall_pop_stall_numbers", v || null)}
          onBlur={() => commit("stall_pop_stall_numbers")}
        />
        <div className="space-y-2">
          <CheckboxField
            label="Trailer stall"
            checked={draft.has_trailer_stall}
            disabled={!canEdit}
            onChange={(b) => {
              patch("has_trailer_stall", b);
              mutation.mutate({ has_trailer_stall: b });
              if (!b) {
                patch("trailer_stall_number", null);
                mutation.mutate({ trailer_stall_number: null });
              }
            }}
          />
          {draft.has_trailer_stall && (
            <TextField
              id="trailer-stall-number"
              label="Trailer stall #"
              placeholder="e.g. 12"
              value={draft.trailer_stall_number ?? ""}
              disabled={!canEdit}
              onChange={(v) => patch("trailer_stall_number", v || null)}
              onBlur={() => commit("trailer_stall_number")}
            />
          )}
        </div>
      </div>
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// 2. Site features (stores.* toggles + reno_scopes.* conditions)
// ----------------------------------------------------------------------------

function SiteFeaturesCard({
  scope,
  attrs,
  canEdit,
  preConMutation,
}: {
  scope: RenoScope;
  attrs: StoreStallAttributes;
  canEdit: boolean;
  preConMutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  const queryClient = useQueryClient();
  const featureMutation = useMutation({
    mutationFn: (patch: Partial<StoreStallAttributes>) =>
      updateScopeStoreAttributes(scope.id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ATTRIBUTE_QUERY_KEY(scope.store_id) });
    },
  });

  function toggleFeature(key: "has_stall_canopy" | "has_clearance_bar" | "has_dt_order_canopy", v: boolean) {
    featureMutation.mutate({ [key]: v } as Partial<StoreStallAttributes>);
    // If the toggle goes off, clear any condition we already captured.
    if (!v && key === "has_stall_canopy" && scope.stall_canopy_condition) {
      preConMutation.mutate({ stall_canopy_condition: null });
    }
    if (!v && key === "has_dt_order_canopy" && scope.dt_order_canopy_condition) {
      preConMutation.mutate({ dt_order_canopy_condition: null });
    }
  }

  return (
    <CardWithHeader
      icon={MapPin}
      title="Site features"
      subtitle="Building features present today. Conditions show up when a feature is enabled."
      mutation={featureMutation}
    >
      <div className="space-y-3">
        <FeatureRow
          label="Stall canopy"
          enabled={attrs.has_stall_canopy}
          disabled={!canEdit}
          onToggle={(v) => toggleFeature("has_stall_canopy", v)}
        >
          {attrs.has_stall_canopy && (
            <Segmented
              value={scope.stall_canopy_condition}
              disabled={!canEdit || preConMutation.isPending}
              options={[
                { value: "good", label: "Good" },
                { value: "fair", label: "Fair" },
                { value: "poor", label: "Poor" },
                { value: "remove", label: "Remove" },
              ]}
              onChange={(v) =>
                preConMutation.mutate({
                  stall_canopy_condition: v as StallCanopyCondition | null,
                })
              }
            />
          )}
        </FeatureRow>

        <FeatureRow
          label="Clearance bar"
          enabled={attrs.has_clearance_bar}
          disabled={!canEdit}
          onToggle={(v) => toggleFeature("has_clearance_bar", v)}
        />

        <FeatureRow
          label="DT order canopy"
          enabled={attrs.has_dt_order_canopy}
          disabled={!canEdit}
          onToggle={(v) => toggleFeature("has_dt_order_canopy", v)}
        >
          {attrs.has_dt_order_canopy && (
            <Segmented
              value={scope.dt_order_canopy_condition}
              disabled={!canEdit || preConMutation.isPending}
              options={[
                { value: "good", label: "Good" },
                { value: "fair", label: "Fair" },
                { value: "poor", label: "Poor" },
                { value: "replace", label: "Replace" },
              ]}
              onChange={(v) =>
                preConMutation.mutate({
                  dt_order_canopy_condition: v as DtOrderCanopyCondition | null,
                })
              }
            />
          )}
        </FeatureRow>
      </div>
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// 3. Demolition inventory (reno_scopes.*)
// ----------------------------------------------------------------------------

function DemolitionInventoryCard({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  const draft = useDraftMirror(scope, [
    "existing_acorn_pendant_count",
    "existing_wall_pack_count",
    "existing_patio_furniture_count",
    "existing_trashcan_count",
    "existing_building_signs_count",
    "existing_directional_signs_count",
  ]);

  return (
    <CardWithHeader
      icon={Eraser}
      title="Demolition inventory"
      subtitle="Counts of existing items the GC will remove. Drives the demo bill of materials."
      mutation={mutation}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NumField
          id="acorn-pendant"
          label="# Acorn pendant lights"
          value={draft.values.existing_acorn_pendant_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("existing_acorn_pendant_count", v)}
          onBlur={() => draft.commit("existing_acorn_pendant_count", mutation)}
        />
        <NumField
          id="wall-pack"
          label="# Wall pack lights"
          value={draft.values.existing_wall_pack_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("existing_wall_pack_count", v)}
          onBlur={() => draft.commit("existing_wall_pack_count", mutation)}
        />
        <NumField
          id="patio-furn"
          label="# Existing patio pieces"
          value={draft.values.existing_patio_furniture_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("existing_patio_furniture_count", v)}
          onBlur={() => draft.commit("existing_patio_furniture_count", mutation)}
        />
        <NumField
          id="trashcans"
          label="# Existing trashcans"
          value={draft.values.existing_trashcan_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("existing_trashcan_count", v)}
          onBlur={() => draft.commit("existing_trashcan_count", mutation)}
        />
        <NumField
          id="bldg-signs"
          label="# Existing building signs"
          value={draft.values.existing_building_signs_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("existing_building_signs_count", v)}
          onBlur={() => draft.commit("existing_building_signs_count", mutation)}
        />
        <NumField
          id="dir-signs"
          label="# Existing directional signs"
          value={draft.values.existing_directional_signs_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("existing_directional_signs_count", v)}
          onBlur={() => draft.commit("existing_directional_signs_count", mutation)}
        />
      </div>
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// 4. Bollards (reno_scopes.*)
// ----------------------------------------------------------------------------

function BollardsCard({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  const draft = useDraftMirror(scope, [
    "bollard_count",
    "bollard_needs_repair_count",
    "bollard_notes",
  ]);

  return (
    <CardWithHeader
      icon={ShieldAlert}
      title="Bollards"
      subtitle="Total count + how many need repair (paint, replace, straighten). Attach photos via Photos tab → item #220."
      mutation={mutation}
    >
      <div className="grid gap-3 sm:grid-cols-[160px_160px_1fr]">
        <NumField
          id="bollard-count"
          label="Total bollards"
          value={draft.values.bollard_count}
          disabled={!canEdit}
          onChange={(v) => draft.set("bollard_count", v)}
          onBlur={() => draft.commit("bollard_count", mutation)}
        />
        {draft.values.bollard_count > 0 && (
          <>
            <NumField
              id="bollard-repair"
              label="# Need repair"
              value={draft.values.bollard_needs_repair_count}
              disabled={!canEdit}
              onChange={(v) => draft.set("bollard_needs_repair_count", v)}
              onBlur={() => draft.commit("bollard_needs_repair_count", mutation)}
            />
            <div>
              <Label htmlFor="bollard-notes">Notes</Label>
              <textarea
                id="bollard-notes"
                rows={2}
                value={draft.values.bollard_notes ?? ""}
                disabled={!canEdit}
                onChange={(e) =>
                  draft.set("bollard_notes", e.target.value || null)
                }
                onBlur={() => draft.commit("bollard_notes", mutation)}
                placeholder="e.g. SW corner has 2 leaning; 1 missing cap"
                className={textareaClass}
              />
            </div>
          </>
        )}
      </div>
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// 5. Surface conditions (reno_scopes.*)
// ----------------------------------------------------------------------------

function SurfaceConditionsCard({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  return (
    <CardWithHeader
      icon={Hammer}
      title="Surface conditions"
      subtitle="Paint / coating prep readiness. Drives labor estimates beyond the standard scope."
      mutation={mutation}
    >
      <div className="space-y-3">
        <SegmentedRow
          label="Steel rust severity"
          value={scope.steel_rust_severity}
          disabled={!canEdit || mutation.isPending}
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ]}
          onChange={(v) =>
            mutation.mutate({ steel_rust_severity: v as SteelRustSeverity | null })
          }
        />
        <SegmentedRow
          label="Stucco / EIFS condition"
          value={scope.stucco_eifs_condition}
          disabled={!canEdit || mutation.isPending}
          options={[
            { value: "good", label: "Good" },
            { value: "minor_cracks", label: "Minor cracks" },
            { value: "needs_patch", label: "Needs patch" },
          ]}
          onChange={(v) =>
            mutation.mutate({ stucco_eifs_condition: v as StuccoEifsCondition | null })
          }
        />
        <SegmentedRow
          label="Doghouse disposition"
          value={scope.doghouse_disposition}
          disabled={!canEdit || mutation.isPending}
          options={[
            { value: "paint", label: "Paint" },
            { value: "replace", label: "Replace" },
          ]}
          onChange={(v) =>
            mutation.mutate({ doghouse_disposition: v as DoghouseDisposition | null })
          }
        />
        <NichihaField scope={scope} canEdit={canEdit} mutation={mutation} />
      </div>
    </CardWithHeader>
  );
}

function NichihaField({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  const [value, setValue] = useState<number>(scope.nichiha_damage_count ?? 0);
  useEffect(() => setValue(scope.nichiha_damage_count ?? 0), [scope.nichiha_damage_count]);
  return (
    <NumField
      id="nichiha-damage"
      label="# Nichiha panels to replace"
      value={value}
      disabled={!canEdit}
      onChange={setValue}
      onBlur={() => {
        if (value !== (scope.nichiha_damage_count ?? 0)) {
          mutation.mutate({ nichiha_damage_count: value });
        }
      }}
    />
  );
}

// ----------------------------------------------------------------------------
// 6. Existing signage (reno_scopes.*)
// ----------------------------------------------------------------------------

function ExistingSignageCard({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  return (
    <CardWithHeader
      icon={Megaphone}
      title="Existing signage"
      subtitle="What's on site today and what needs to happen to it during reskin."
      mutation={mutation}
    >
      <SegmentedRow
        label="Pylon / monument sign"
        value={scope.pylon_sign_condition}
        disabled={!canEdit || mutation.isPending}
        options={[
          { value: "good", label: "Good (keep)" },
          { value: "reface", label: "Reface" },
          { value: "replace", label: "Replace" },
          { value: "none", label: "No pylon" },
        ]}
        onChange={(v) =>
          mutation.mutate({ pylon_sign_condition: v as PylonSignCondition | null })
        }
      />
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// 7. Site notes (reno_scopes.*)
// ----------------------------------------------------------------------------

function SiteNotesCard({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>;
}) {
  const draft = useDraftMirror(scope, ["drainage_issues_notes"]);
  return (
    <CardWithHeader
      icon={MapPin}
      title="Site notes"
      subtitle="Dumpster enclosure readiness + drainage findings."
      mutation={mutation}
    >
      <div className="space-y-3">
        <TripleToggleRow
          label="Dumpster enclosure paint-ready?"
          value={scope.dumpster_enclosure_ready}
          disabled={!canEdit || mutation.isPending}
          onChange={(v) =>
            mutation.mutate({ dumpster_enclosure_ready: v })
          }
        />
        <div>
          <Label htmlFor="drainage-notes">Drainage issues</Label>
          <textarea
            id="drainage-notes"
            rows={2}
            value={draft.values.drainage_issues_notes ?? ""}
            disabled={!canEdit}
            onChange={(e) =>
              draft.set("drainage_issues_notes", e.target.value || null)
            }
            onBlur={() => draft.commit("drainage_issues_notes", mutation)}
            placeholder="e.g. Ponding at SE corner of patio after rain"
            className={textareaClass}
          />
        </div>
      </div>
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// 8. Damaged Order Ahead signs (existing — reno_scopes.*)
// ----------------------------------------------------------------------------

function DamagedSignsCard({
  scope,
  canEdit,
  mutation,
}: {
  scope: RenoScope;
  canEdit: boolean;
  mutation: ReturnType<typeof useMutation<RenoScope, Error, {
    damaged_oa_signs_count?: number;
    damaged_oa_signs_notes?: string | null;
  }>>;
}) {
  const [count, setCount] = useState<number>(scope.damaged_oa_signs_count ?? 0);
  const [notes, setNotes] = useState<string>(scope.damaged_oa_signs_notes ?? "");
  useEffect(() => {
    setCount(scope.damaged_oa_signs_count ?? 0);
    setNotes(scope.damaged_oa_signs_notes ?? "");
  }, [scope.damaged_oa_signs_count, scope.damaged_oa_signs_notes]);

  return (
    <CardWithHeader
      icon={AlertTriangle}
      title="Damaged Order Ahead signs"
      subtitle="Number of damaged OA signs (drives the replacement order). Notes for context."
      iconClassName="text-amber-600"
      mutation={mutation}
    >
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <NumField
          id="damaged-oa-count"
          label="# Damaged"
          value={count}
          disabled={!canEdit}
          onChange={setCount}
          onBlur={() => {
            if (count !== (scope.damaged_oa_signs_count ?? 0)) {
              mutation.mutate({ damaged_oa_signs_count: count });
            }
          }}
        />
        <div>
          <Label htmlFor="damaged-oa-notes">Notes</Label>
          <textarea
            id="damaged-oa-notes"
            rows={3}
            value={notes}
            disabled={!canEdit}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              const next = notes.trim() || null;
              const prev = scope.damaged_oa_signs_notes ?? null;
              if (next !== prev) {
                mutation.mutate({ damaged_oa_signs_notes: next });
              }
            }}
            placeholder="e.g. Stalls 3 and 7 — faded; #5 has a cracked face."
            className={textareaClass}
          />
        </div>
      </div>
    </CardWithHeader>
  );
}

// ----------------------------------------------------------------------------
// Card + field helpers
// ----------------------------------------------------------------------------

const textareaClass =
  "w-full resize-none rounded-md border-0 bg-zinc-50 px-3 py-2 text-sm text-midnight ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-frost disabled:cursor-not-allowed";

function CardWithHeader({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  mutation,
  children,
}: {
  icon: typeof Building2;
  iconClassName?: string;
  title: string;
  subtitle?: string;
  mutation: { isPending: boolean; isSuccess: boolean; isError: boolean; error: unknown };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="space-y-3 p-4">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4 text-zinc-500", iconClassName)} strokeWidth={2} />
            <h3 className="text-sm font-semibold text-midnight">{title}</h3>
          </div>
          <SaveStatus
            saving={mutation.isPending}
            saved={mutation.isSuccess}
            error={mutation.isError ? (mutation.error as Error)?.message ?? "Failed" : null}
          />
        </header>
        {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        {children}
      </div>
    </Card>
  );
}

function NumField({
  id,
  label,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
        }}
        onBlur={onBlur}
      />
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  disabled,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200">
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-zinc-700">{label}</span>
    </label>
  );
}

function FeatureRow({
  label,
  enabled,
  disabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md bg-zinc-50 p-3 ring-1 ring-zinc-200">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-700">{label}</span>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          Present
        </label>
      </div>
      {children}
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T | null;
  options: SegmentedOption<T>[];
  disabled: boolean;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(active ? null : o.value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "bg-midnight text-white ring-midnight"
                : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SegmentedRow<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T | null;
  options: SegmentedOption<T>[];
  disabled: boolean;
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-zinc-700">{label}</p>
      <Segmented<T> value={value} options={options} disabled={disabled} onChange={onChange} />
    </div>
  );
}

// 3-way Y / N / unknown toggle for boolean fields where "not yet
// assessed" is a meaningful state. Used for dumpster_enclosure_ready.
function TripleToggleRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean | null;
  disabled: boolean;
  onChange: (v: boolean | null) => void;
}) {
  return (
    <SegmentedRow
      label={label}
      value={value === null ? null : value ? "yes" : "no"}
      disabled={disabled}
      options={[
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ]}
      onChange={(v) => onChange(v === null ? null : v === "yes")}
    />
  );
}

function SaveStatus({
  saving,
  saved,
  error,
}: {
  saving: boolean;
  saved: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-700">
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
        {error}
      </span>
    );
  }
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
        Saving…
      </span>
    );
  }
  if (saved) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
        <Check className="h-3 w-3" strokeWidth={2} />
        Saved
      </span>
    );
  }
  return null;
}

// ----------------------------------------------------------------------------
// useDraftMirror — local form state mirror with commit-on-blur for the
// reno_scopes.* fields. Each card declares which scope fields it owns,
// and the hook returns { values, set, commit }.
// ----------------------------------------------------------------------------

function useDraftMirror<K extends keyof RenoScope>(
  scope: RenoScope,
  keys: K[],
): {
  values: Pick<RenoScope, K>;
  set: <KK extends K>(key: KK, value: RenoScope[KK]) => void;
  commit: <KK extends K>(
    key: KK,
    mutation: ReturnType<typeof useMutation<RenoScope, Error, PreConFindingsPatch>>,
  ) => void;
} {
  const initial = useMemo(() => {
    const out = {} as Pick<RenoScope, K>;
    for (const k of keys) out[k] = scope[k];
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, ...keys.map((k) => scope[k])]);
  const [values, setValues] = useState<Pick<RenoScope, K>>(initial);
  useEffect(() => setValues(initial), [initial]);

  return {
    values,
    set: (key, value) => setValues((v) => ({ ...v, [key]: value })),
    commit: (key, mutation) => {
      if (values[key] === scope[key]) return;
      mutation.mutate({ [key]: values[key] } as PreConFindingsPatch);
    },
  };
}
