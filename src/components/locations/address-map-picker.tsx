"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AddressFields } from "./address-manual-form";
import type { GeocodingResult } from "@/app/api/geocode/route";

// Fix Leaflet default marker icon (missing in bundled builds)
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Attribution required by Carto + OSM
const CARTO_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

interface ClickHandlerProps {
  onMapClick: (lat: number, lng: number) => void;
}

function ClickHandler({ onMapClick }: ClickHandlerProps) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface AddressMapPickerProps {
  value: AddressFields;
  onChange: (fields: AddressFields) => void;
}

export function AddressMapPicker({ value, onChange }: AddressMapPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const center: [number, number] =
    value.latitude != null && value.longitude != null
      ? [value.latitude, value.longitude]
      : [48.8566, 2.3522]; // Default: Paris

  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      setIsReversing(true);
      try {
        const params = new URLSearchParams({
          mode: "reverse",
          lat: lat.toString(),
          lon: lng.toString(),
        });
        const res = await fetch(`/api/geocode?${params}`);
        const data = (await res.json()) as { results: GeocodingResult[] };
        if (data.results?.length) {
          const r = data.results[0];
          onChange({
            street: r.street || "",
            city: r.city || "",
            region: r.region || "",
            country: r.country || "",
            countryCode: r.countryCode || "",
            postalCode: r.postalCode || "",
            latitude: lat,
            longitude: lng,
          });
        } else {
          onChange({ ...value, latitude: lat, longitude: lng });
        }
      } catch {
        onChange({ ...value, latitude: lat, longitude: lng });
      } finally {
        setIsReversing(false);
      }
    },
    [onChange, value],
  );

  function handleMapClick(lat: number, lng: number) {
    reverseGeocode(lat, lng);
    if (mapRef.current) {
      mapRef.current.flyTo([lat, lng], mapRef.current.getZoom());
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);

    try {
      const params = new URLSearchParams({
        mode: "search",
        q: searchQuery.trim(),
      });
      const res = await fetch(`/api/geocode?${params}`);
      const data = (await res.json()) as { results: GeocodingResult[] };
      if (!data.results?.length) {
        setSearchError("No results found");
        return;
      }
      const r = data.results[0];
      onChange({
        street: r.street || "",
        city: r.city || "",
        region: r.region || "",
        country: r.country || "",
        countryCode: r.countryCode || "",
        postalCode: r.postalCode || "",
        latitude: r.latitude,
        longitude: r.longitude,
      });
      if (mapRef.current) {
        mapRef.current.flyTo([r.latitude, r.longitude], 14);
      }
    } catch {
      setSearchError("Search failed");
    } finally {
      setIsSearching(false);
    }
  }

  // Import leaflet CSS once on mount
  useEffect(() => {
    const id = "leaflet-css";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Search location"
            id="map-search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchError(null);
            }}
            placeholder="Amsterdam, Netherlands"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
              }
            }}
            error={searchError ?? undefined}
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={handleSearch}
          disabled={isSearching}
          className="mb-[1px]"
        >
          {isSearching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          Search
        </Button>
      </div>

      <div className="relative h-[260px] w-full overflow-hidden rounded-sm border border-glass-border">
        <MapContainer
          center={center}
          zoom={value.latitude != null ? 14 : 3}
          className="h-full w-full"
          ref={mapRef}
          attributionControl={true}
        >
          <TileLayer url={CARTO_DARK} attribution={ATTRIBUTION} />
          <ClickHandler onMapClick={handleMapClick} />
          {value.latitude != null && value.longitude != null && (
            <Marker position={[value.latitude, value.longitude]} icon={markerIcon} />
          )}
        </MapContainer>
        {isReversing && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-bg-primary/50">
            <Loader2 className="h-5 w-5 animate-spin text-fg-secondary" strokeWidth={1.5} />
          </div>
        )}
      </div>

      {value.city && (
        <div className="rounded-sm border border-glass-border bg-bg-primary p-3 text-xs text-fg-secondary">
          <p className="font-medium text-fg-primary">
            {[value.street, value.city, value.region, value.postalCode, value.country]
              .filter(Boolean)
              .join(", ")}
          </p>
          {value.latitude != null && value.longitude != null && (
            <p className="mt-1 font-mono text-fg-muted">
              {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
