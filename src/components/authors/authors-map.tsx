"use client";

import { useCallback, useRef, useState } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  type MapRef,
} from "react-map-gl/mapbox";
import type { CircleLayer, SymbolLayer, MapMouseEvent, GeoJSONSource } from "mapbox-gl";
import type { FeatureCollection, Feature, Point } from "geojson";
import Link from "next/link";
import "mapbox-gl/dist/mapbox-gl.css";
import type { AuthorMapPoint } from "@/lib/actions/author-map";

interface AuthorProperties {
  id: string;
  name: string;
  slug: string;
  locationName: string;
  posterUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
}

interface SelectedAuthor {
  id: string;
  name: string;
  slug: string;
  latitude: number;
  longitude: number;
  locationName: string;
  posterUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
}

const clusterCircleLayer: CircleLayer = {
  id: "clusters",
  type: "circle",
  source: "authors",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": "#6b5b73",
    "circle-radius": [
      "step",
      ["get", "point_count"],
      20,
      10,
      30,
      50,
      40,
    ],
    "circle-opacity": 0.85,
    "circle-stroke-width": 1,
    "circle-stroke-color": "rgba(255,255,255,0.1)",
  },
};

const clusterCountLayer: SymbolLayer = {
  id: "cluster-count",
  type: "symbol",
  source: "authors",
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count_abbreviated"],
    "text-size": 12,
    "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
  },
  paint: {
    "text-color": "#e0dcd4",
  },
};

const unclusteredPointLayer: CircleLayer = {
  id: "unclustered-point",
  type: "circle",
  source: "authors",
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": "#8b7d96",
    "circle-radius": 6,
    "circle-stroke-width": 1,
    "circle-stroke-color": "rgba(255,255,255,0.15)",
  },
};

interface AuthorsMapProps {
  authors: AuthorMapPoint[];
}

export function AuthorsMap({ authors }: AuthorsMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedAuthor, setSelectedAuthor] = useState<SelectedAuthor | null>(null);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const geojson: FeatureCollection<Point, AuthorProperties> = {
    type: "FeatureCollection",
    features: authors.map((a): Feature<Point, AuthorProperties> => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [a.longitude, a.latitude],
      },
      properties: {
        id: a.id,
        name: a.name,
        slug: a.slug,
        locationName: a.locationName,
        posterUrl: a.posterUrl,
        birthYear: a.birthYear,
        deathYear: a.deathYear,
      },
    })),
  };

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;

      const features = map.queryRenderedFeatures(e.point, {
        layers: ["clusters", "unclustered-point"],
      });

      if (!features.length) return;

      const feature = features[0];
      const layerId = feature.layer?.id;

      if (layerId === "clusters") {
        const clusterId = feature.properties?.cluster_id as number | undefined;
        if (clusterId == null) return;

        const source = map.getSource("authors") as GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          const geometry = feature.geometry as Point;
          map.easeTo({
            center: [geometry.coordinates[0], geometry.coordinates[1]],
            zoom: zoom ?? 8,
            duration: 500,
          });
        });
      } else if (layerId === "unclustered-point") {
        const props = feature.properties as Record<string, unknown>;
        const geometry = feature.geometry as Point;

        const posterRaw = props.posterUrl;
        const posterUrl =
          posterRaw == null || posterRaw === "null" || posterRaw === ""
            ? null
            : String(posterRaw);

        const birthRaw = props.birthYear;
        const birthYear =
          birthRaw == null || birthRaw === "null" ? null : Number(birthRaw);

        const deathRaw = props.deathYear;
        const deathYear =
          deathRaw == null || deathRaw === "null" ? null : Number(deathRaw);

        setSelectedAuthor({
          id: String(props.id),
          name: String(props.name),
          slug: String(props.slug),
          latitude: geometry.coordinates[1],
          longitude: geometry.coordinates[0],
          locationName: String(props.locationName ?? ""),
          posterUrl,
          birthYear,
          deathYear,
        });
      }
    },
    [],
  );

  const onMouseEnter = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "pointer";
  }, []);

  const onMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "";
  }, []);

  if (!token) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-fg-muted">
          Map unavailable —{" "}
          <code className="text-fg-secondary">NEXT_PUBLIC_MAPBOX_TOKEN</code> is
          not configured.
        </p>
      </div>
    );
  }

  if (authors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-fg-muted">
          No authors with location data match the current filters.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden rounded-sm border border-glass-border">
      <Map
        ref={mapRef}
        mapboxAccessToken={token}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        initialViewState={{
          longitude: 10,
          latitude: 30,
          zoom: 1.5,
        }}
        style={{ width: "100%", height: "100%" }}
        interactiveLayerIds={["clusters", "unclustered-point"]}
        onClick={handleMapClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <Source
          id="authors"
          type="geojson"
          data={geojson}
          cluster={true}
          clusterMaxZoom={14}
          clusterRadius={50}
        >
          <Layer {...clusterCircleLayer} />
          <Layer {...clusterCountLayer} />
          <Layer {...unclusteredPointLayer} />
        </Source>

        {selectedAuthor && (
          <Popup
            latitude={selectedAuthor.latitude}
            longitude={selectedAuthor.longitude}
            onClose={() => setSelectedAuthor(null)}
            closeButton={false}
            closeOnClick={false}
            anchor="bottom"
            offset={12}
            className="author-map-popup"
          >
            <div
              className="relative min-w-[160px] max-w-[220px] rounded-sm bg-bg-secondary p-3"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-start gap-2">
                {selectedAuthor.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedAuthor.posterUrl}
                    alt={selectedAuthor.name}
                    className="h-12 w-9 flex-shrink-0 rounded-sm object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/authors/${selectedAuthor.slug}`}
                    className="block truncate font-serif text-sm font-medium text-fg-primary hover:text-accent-rose"
                  >
                    {selectedAuthor.name}
                  </Link>
                  {selectedAuthor.locationName && (
                    <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">
                      {selectedAuthor.locationName}
                    </p>
                  )}
                  {selectedAuthor.birthYear != null && (
                    <p className="mt-1 font-mono text-xs text-fg-muted">
                      {selectedAuthor.birthYear}
                      {selectedAuthor.deathYear != null
                        ? `\u2013${selectedAuthor.deathYear}`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedAuthor(null)}
                className="absolute right-2 top-2 text-fg-muted hover:text-fg-secondary"
                aria-label="Close"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M1 1l8 8M9 1L1 9" />
                </svg>
              </button>
            </div>
          </Popup>
        )}
      </Map>

      <style>{`
        .author-map-popup .mapboxgl-popup-content {
          background: transparent;
          padding: 0;
          box-shadow: none;
          border-radius: 2px;
        }
        .author-map-popup .mapboxgl-popup-tip {
          border-top-color: rgba(255,255,255,0.08);
        }
      `}</style>
    </div>
  );
}
