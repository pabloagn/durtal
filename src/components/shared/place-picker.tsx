"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Loader2, MapPin, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  createPlace,
  createPlaceFromGeocode,
  searchPlaces,
} from "@/lib/actions/places";
import type { GeocodingResult } from "@/app/api/geocode/route";

export interface PlaceValue {
  id: string;
  name: string;
  fullName: string | null;
}

interface PlacePickerProps {
  label: string;
  value: PlaceValue | null;
  onChange: (value: PlaceValue | null) => void;
  disabled?: boolean;
}

type LocalPlace = Awaited<ReturnType<typeof searchPlaces>>[number];

const rowClass =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-40";

function localDetail(p: LocalPlace) {
  return p.fullName ?? [p.name, p.parent?.name, p.country?.name].filter(Boolean).join(", ");
}

/**
 * Pick a geographic place: search existing places, look one up worldwide
 * (Nominatim via /api/geocode, on request only), or add one by name.
 */
export function PlacePicker({ label, value, onChange, disabled }: PlacePickerProps) {
  const [query, setQuery] = useState("");
  const [local, setLocal] = useState<LocalPlace[]>([]);
  const [geo, setGeo] = useState<GeocodingResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setGeo(null);
    if (!q) {
      setLocal([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setLocal(await searchPlaces(q, 8));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  function select(place: { id: string; name: string; fullName: string | null }) {
    onChange({ id: place.id, name: place.name, fullName: place.fullName });
    setQuery("");
    setLocal([]);
    setGeo(null);
  }

  async function searchWorldwide() {
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode?mode=search&q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { results?: GeocodingResult[] };
      setGeo(data.results ?? []);
    } catch {
      toast.error("Place search failed");
    } finally {
      setSearching(false);
    }
  }

  async function run(action: () => Promise<PlaceValue | null>) {
    setBusy(true);
    try {
      const place = await action();
      if (place) select(place);
    } catch {
      toast.error("Failed to save place");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <Input
        label={label}
        value={value.fullName ?? value.name}
        readOnly
        disabled={disabled}
        suffix={
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label={`Clear ${label.toLowerCase()}`}
            data-tooltip="Clear"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-secondary transition-colors duration-150 hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Input
        label={label}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Esc closes the list under the field, as the publisher picker's
        // does; the dialog around it stays until the next Esc (SLN-477)
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            e.preventDefault();
            setQuery("");
          }
        }}
        placeholder="Search a city"
        disabled={disabled || busy}
        // Always set, so the field keeps its focus when the spinner shows
        suffix={
          <span className="flex h-6 w-6 items-center justify-center text-fg-secondary">
            {(searching || busy) && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            )}
          </span>
        }
      />

      {q && (
        <div className="max-h-48 overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary">
          {local.map((p) => (
            <button key={p.id} type="button" disabled={busy} onClick={() => select(p)} className={rowClass}>
              <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">{localDetail(p)}</span>
            </button>
          ))}
          {geo?.map((g, i) => (
            <button
              key={`${g.latitude},${g.longitude},${i}`}
              type="button"
              disabled={busy}
              onClick={() => run(() => createPlaceFromGeocode(g))}
              className={rowClass}
            >
              <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">{g.displayName}</span>
            </button>
          ))}
          {geo?.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-fg-secondary">No places found worldwide.</p>
          )}
          {geo === null && (
            <button type="button" disabled={busy || searching} onClick={searchWorldwide} className={rowClass}>
              <Globe className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Search worldwide for &ldquo;{q}&rdquo;</span>
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => createPlace({ name: q, type: "city" }))}
            className={rowClass}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Add &ldquo;{q}&rdquo; without coordinates</span>
          </button>
        </div>
      )}
    </div>
  );
}
