// /reno-scoping/new — create a scope. Pick a store, building type, and
// preferred vendors. Cohort auto-derives server-side from stores.state.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card } from "@/shared/ui/Card";
import { Skeleton } from "@/shared/ui/Skeleton";
import { Input } from "@/shared/ui/Input";
import { Label } from "@/shared/ui/Label";
import { Button } from "@/shared/ui/Button";
import { createScope, fetchScopableStores, type StoreOption } from "./api";
import {
  BUILDING_TYPE_LABELS,
  type BuildingType,
} from "./types";

const BUILDING_TYPES: BuildingType[] = [
  "center_tower_curved",
  "dt_tower_curved",
  "center_tower_flat",
  "brick_stone",
];

export function NewScopePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeQuery, setStoreQuery] = useState("");
  const [buildingType, setBuildingType] = useState<BuildingType | null>(null);
  const [scopeDate, setScopeDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [signageVendor, setSignageVendor] = useState("");
  const [canopyVendor, setCanopyVendor] = useState("");
  const [gc, setGc] = useState("");
  const [paintContractor, setPaintContractor] = useState("");

  const storesQuery = useQuery({
    queryKey: ["reno-scopable-stores"],
    queryFn: fetchScopableStores,
    staleTime: 5 * 60_000,
  });

  const selectedStore = useMemo(() => {
    if (!storeId) return null;
    return storesQuery.data?.find((s) => s.id === storeId) ?? null;
  }, [storeId, storesQuery.data]);

  const filteredStores = useMemo(() => {
    const q = storeQuery.trim().toLowerCase();
    const rows = storesQuery.data ?? [];
    if (!q) return rows.slice(0, 25);
    return rows
      .filter((s) => {
        const hay = [s.number, s.name, s.state].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 25);
  }, [storeQuery, storesQuery.data]);

  const createMutation = useMutation({
    mutationFn: createScope,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["reno-scopes"] });
      navigate(`/reno-scoping/${created.id}`);
    },
  });

  const canSubmit = !!storeId && !!buildingType && !!scopeDate;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !buildingType) return;
    createMutation.mutate({
      store_id: storeId,
      building_type: buildingType,
      scope_date: scopeDate,
      preferred_signage_vendor: signageVendor.trim() || null,
      preferred_canopy_vendor: canopyVendor.trim() || null,
      preferred_gc: gc.trim() || null,
      preferred_paint_contractor: paintContractor.trim() || null,
    });
  }

  return (
    <>
      <PageHeader
        title="New Scope"
        description="Pick a store and set the building basics. You'll fill the checklist on the next screen."
        actions={
          <Link to="/reno-scoping">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Back
            </Button>
          </Link>
        }
      />

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <div className="space-y-3 p-4">
            <div>
              <Label>Store</Label>
              {selectedStore ? (
                <div className="mt-1 flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 ring-1 ring-zinc-200">
                  <div>
                    <span className="text-sm font-semibold text-midnight">
                      {selectedStore.number}
                    </span>
                    <span className="ml-2 text-sm text-zinc-700">{selectedStore.name}</span>
                    {selectedStore.state && (
                      <span className="ml-1 text-xs text-zinc-400">· {selectedStore.state}</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStoreId(null);
                      setStoreQuery("");
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <StorePicker
                  loading={storesQuery.isLoading}
                  storeQuery={storeQuery}
                  onQueryChange={setStoreQuery}
                  stores={filteredStores}
                  onPick={(s) => {
                    setStoreId(s.id);
                    setStoreQuery("");
                  }}
                />
              )}
            </div>

            <div>
              <Label>Building type</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {BUILDING_TYPES.map((bt) => (
                  <button
                    key={bt}
                    type="button"
                    onClick={() => setBuildingType(bt)}
                    className={
                      "rounded-md px-3 py-2 text-left text-sm ring-1 ring-inset transition " +
                      (buildingType === bt
                        ? "bg-midnight text-white ring-midnight"
                        : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50")
                    }
                  >
                    {BUILDING_TYPE_LABELS[bt]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="scope-date">Scope date</Label>
                <Input
                  id="scope-date"
                  type="date"
                  value={scopeDate}
                  onChange={(e) => setScopeDate(e.target.value)}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="space-y-3 p-4">
            <div>
              <h3 className="text-sm font-semibold text-midnight">Preferred vendors</h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Optional. Header-level only for v1 — no per-item vendor picks.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="signage">Signage vendor</Label>
                <Input
                  id="signage"
                  placeholder="AGI · Design Team · Everbrite · Persona"
                  value={signageVendor}
                  onChange={(e) => setSignageVendor(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="canopy">Canopy vendor</Label>
                <Input
                  id="canopy"
                  placeholder="Mira · Arning"
                  value={canopyVendor}
                  onChange={(e) => setCanopyVendor(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="gc">General contractor</Label>
                <Input
                  id="gc"
                  placeholder="From approved GC list"
                  value={gc}
                  onChange={(e) => setGc(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="paint">Paint contractor</Label>
                <Input
                  id="paint"
                  placeholder="Sherwin Williams network"
                  value={paintContractor}
                  onChange={(e) => setPaintContractor(e.target.value)}
                />
              </div>
            </div>
          </div>
        </Card>

        {createMutation.isError && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
            {(createMutation.error as Error)?.message ?? "Couldn't create scope."}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link to="/reno-scoping">
            <Button type="button" variant="secondary">Cancel</Button>
          </Link>
          <Button type="submit" disabled={!canSubmit || createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create scope"}
          </Button>
        </div>
      </form>
    </>
  );
}

function StorePicker({
  loading,
  storeQuery,
  onQueryChange,
  stores,
  onPick,
}: {
  loading: boolean;
  storeQuery: string;
  onQueryChange: (q: string) => void;
  stores: StoreOption[];
  onPick: (s: StoreOption) => void;
}) {
  return (
    <div className="mt-1 space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
          strokeWidth={1.75}
        />
        <Input
          type="search"
          value={storeQuery}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by store number, name, or state"
          className="pl-9"
        />
      </div>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-md ring-1 ring-zinc-200 bg-white">
          {stores.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500">No stores match.</p>
          ) : (
            stores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s)}
                className="block w-full border-b border-zinc-100 px-3 py-2 text-left text-sm transition last:border-0 hover:bg-zinc-50"
              >
                <span className="font-semibold text-midnight">{s.number}</span>
                <span className="ml-2 text-zinc-700">{s.name}</span>
                {s.state && <span className="ml-1 text-xs text-zinc-400">· {s.state}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
