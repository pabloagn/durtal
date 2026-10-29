"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, MapPin, Plus, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { CapAligned } from "@/components/shared/cap-aligned";
import { toast } from "@/lib/notifications/toast";
import { Input } from "@/components/ui/input";
import {
  searchPlaces,
} from "@/lib/actions/places";
import type { GeocodingResult } from "@/app/api/geocode/route";
import { isComposing } from "@/lib/shortcuts/shortcuts";
import { createPlace, createPlaceFromGeocode } from "@/lib/actions/catalogue-client";

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

// A row shows its whole name, wrapping as it must (names are never cut): the
// icon sits on the first line's cap height
const rowClass =
  "flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-40";
const rowText = "min-w-0 [overflow-wrap:anywhere]";

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

  // The newest search: an older answer that arrives late is dropped
  const latestRef = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const search = ++latestRef.current;
    setGeo(null);
    if (!q) {
      setLocal([]);
      setSearching(false);
      return;
    }
    // Busy from the first key, not from the end of the typing pause (SLN-806)
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchPlaces(q, 8);
        if (search === latestRef.current) setLocal(found);
      } finally {
        if (search === latestRef.current) setSearching(false);
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
    const search = latestRef.current;
    setSearching(true);
    try {
      const res = await fetch(`/api/geocode?mode=search&q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { results?: GeocodingResult[] };
      if (search === latestRef.current) setGeo(data.results ?? []);
    } catch {
      if (search === latestRef.current) toast.error("Place search failed");
    } finally {
      if (search === latestRef.current) setSearching(false);
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
            className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-secondary transition-colors duration-150 hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-40 pointer-coarse:size-11"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Input type="search"
        label={label}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // Esc closes the list under the field, as the publisher picker's
        // does; the dialog around it stays until the next Esc (SLN-477)
        onKeyDown={(e) => {
          if (e.key === "Escape" && q && !isComposing(e)) {
            e.preventDefault();
            setQuery("");
          }
        }}
        placeholder="Search a city"
        disabled={disabled || busy}
        // Always set, so the field keeps its focus when the spinner shows
        suffix={
          <span className="flex h-6 w-6 items-center justify-center text-fg-secondary">
            {(searching || busy) && <Spinner />}
          </span>
        }
      />

      {q && (
        // contain:inline-size: a long place name wraps inside the list
        // instead of widening the form, which sizes a fieldset to its
        // content's narrowest width (SLN-820)
        <div className="max-h-48 overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary [contain:inline-size]">
          {local.map((p) => (
            <button key={p.id} type="button" disabled={busy} onClick={() => select(p)} className={rowClass}>
              <CapAligned height={14}><MapPin className="h-3.5 w-3.5" strokeWidth={1.5} /></CapAligned>
              <span className={rowText}>{localDetail(p)}</span>
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
              <CapAligned height={14}><Globe className="h-3.5 w-3.5" strokeWidth={1.5} /></CapAligned>
              <span className={rowText}>{g.displayName}</span>
            </button>
          ))}
          {geo?.length === 0 && (
            <p className="px-3 py-1.5 text-sm text-fg-secondary">No places found worldwide.</p>
          )}
          {geo === null && (
            <button type="button" disabled={busy || searching} onClick={searchWorldwide} className={rowClass}>
              <CapAligned height={14}><Globe className="h-3.5 w-3.5" strokeWidth={1.5} /></CapAligned>
              <span className={rowText}>Search worldwide for &ldquo;{q}&rdquo;</span>
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => createPlace({ name: q, type: "city" }))}
            className={rowClass}
          >
            <CapAligned height={14}><Plus className="h-3.5 w-3.5" strokeWidth={1.5} /></CapAligned>
            <span className={rowText}>Add &ldquo;{q}&rdquo; without coordinates</span>
          </button>
        </div>
      )}
    </div>
  );
}
