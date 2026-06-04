// Store geofences — admin backfill of walkthrough check-in coordinates.
// Each store gets latitude / longitude / radius. "Use my location" captures
// the device fix (a DO standing at the store), or paste from Google Maps.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Card, CardBody } from "@/shared/ui/Card";
import { Button } from "@/shared/ui/Button";
import { Badge } from "@/shared/ui/Badge";
import { Skeleton } from "@/shared/ui/Skeleton";
import { useToast } from "@/shared/ui/Toaster";
import { Field, NumberInput, TextInput } from "../builder/controls";
import { listStoresGeo, updateStoreGeo, type StoreGeo } from "./api";

export function StoreGeofencesPage() {
  const [q, setQ] = useState("");
  const query = useQuery({ queryKey: ["stores-geo"], queryFn: listStoresGeo });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return query.data ?? [];
    return (query.data ?? []).filter(
      (s) =>
        s.number.toLowerCase().includes(needle) ||
        (s.name ?? "").toLowerCase().includes(needle) ||
        (s.city ?? "").toLowerCase().includes(needle),
    );
  }, [query.data, q]);

  const configured = (query.data ?? []).filter((s) => s.latitude != null && s.longitude != null).length;
  const total = query.data?.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Store geofences"
        description="Set coordinates for the walkthrough GPS check-in. Stores without coordinates skip the geofence."
        actions={total > 0 ? <Badge tone={configured === total ? "success" : "warning"}>{configured}/{total} set</Badge> : undefined}
      />

      <div className="mb-4 flex items-center gap-2 rounded-md ring-1 ring-inset ring-zinc-200 bg-white px-3">
        <Search className="h-4 w-4 text-zinc-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search store # / name / city"
          className="h-9 flex-1 bg-transparent text-sm outline-none"
        />
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Card>
          <CardBody className="text-sm text-red-600">
            {query.error instanceof Error ? query.error.message : "Failed to load."}
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <StoreRow key={s.id} store={s} />
          ))}
          {!filtered.length && <div className="py-10 text-center text-sm text-zinc-400">No stores match.</div>}
        </div>
      )}
    </div>
  );
}

function StoreRow({ store }: { store: StoreGeo }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [lat, setLat] = useState(store.latitude?.toString() ?? "");
  const [lng, setLng] = useState(store.longitude?.toString() ?? "");
  const [radius, setRadius] = useState((store.geofence_radius_m ?? 150).toString());
  const [locating, setLocating] = useState(false);

  const dirty =
    lat !== (store.latitude?.toString() ?? "") ||
    lng !== (store.longitude?.toString() ?? "") ||
    radius !== (store.geofence_radius_m ?? 150).toString();
  const configured = store.latitude != null && store.longitude != null;

  const save = useMutation({
    mutationFn: () =>
      updateStoreGeo(store.id, {
        latitude: lat.trim() === "" ? null : Number(lat),
        longitude: lng.trim() === "" ? null : Number(lng),
        geofence_radius_m: Number(radius) || 150,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stores-geo"] });
      toast.push("Geofence saved", "success");
    },
    onError: (e) => toast.push(e instanceof Error ? e.message : "Save failed", "error"),
  });

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      toast.push("Geolocation not available", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        toast.push("Couldn't get your location", "error");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium text-midnight">
            {store.number} · {store.name}
            {(store.city || store.state) && (
              <span className="ml-1 text-xs font-normal text-zinc-400">
                {[store.city, store.state].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
          <Badge tone={configured ? "success" : "neutral"}>
            <MapPin className="mr-0.5 h-3 w-3" />
            {configured ? "Set" : "Not set"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Latitude">
            <TextInput value={lat} onChange={(e) => setLat(e.target.value)} placeholder="32.5632" inputMode="decimal" />
          </Field>
          <Field label="Longitude">
            <TextInput value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-97.1417" inputMode="decimal" />
          </Field>
          <Field label="Radius (m)">
            <NumberInput value={radius} min={10} max={5000} onChange={(e) => setRadius(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button variant="secondary" className="w-full" onClick={useMyLocation} disabled={locating}>
              {locating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Crosshair className="mr-1.5 h-4 w-4" />}
              Use my location
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
