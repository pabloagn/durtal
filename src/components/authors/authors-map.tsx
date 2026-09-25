"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Map, {
  Source,
  Layer,
  Popup,
  type MapRef,
} from "react-map-gl/mapbox";
import type {
  CircleLayer,
  SymbolLayer,
  MapMouseEvent,
  GeoJSONSource,
  GeoJSONFeature,
  Map as MapboxMap,
  PointLike,
} from "mapbox-gl";
import type { FeatureCollection, Feature, Point } from "geojson";
import Link from "next/link";
import "mapbox-gl/dist/mapbox-gl.css";
import type { AuthorMapPoint } from "@/lib/actions/author-map";
import type { ViewMode } from "@/components/books/view-mode-switcher";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import {
  groupMapAuthors,
  isSingleSpot,
  leafFromFeature,
  type MapAuthorGroup,
  type MapAuthorLeaf,
} from "@/lib/utils/map-groups";
import { shortCountryName, withNationalityFilter } from "@/lib/utils/nationality-param";

interface AuthorProperties {
  id: string;
  name: string;
  slug: string;
  locationName: string;
  posterUrl: string | null;
  birthYear: number | null;
  deathYear: number | null;
  nationalityCode: string | null;
  nationalityName: string | null;
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
  nationalityCode: string | null;
  nationalityName: string | null;
}

type MapSelection =
  | { kind: "author"; author: SelectedAuthor }
  | {
      kind: "group";
      group: MapAuthorGroup;
      latitude: number;
      longitude: number;
      placement: GroupPopupPlacement;
    };

type PopupAnchor = "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface GroupPopupPlacement {
  anchor: PopupAnchor;
  /** Max height of the scrolling author list, so the whole popup fits the map */
  listMaxHeight: number;
  /** Vertical pan (px) that would give the list a usable height, or 0 */
  panY: number;
}

const GROUP_POPUP_WIDTH = 260;
const GROUP_POPUP_OFFSET = 24;
/** Popup tip height plus a small margin to the map edge */
const GROUP_POPUP_TIP_AND_MARGIN = 18;
/** Popup height without the list: padding, title, count and one (two-line) button */
const GROUP_POPUP_CHROME = 170;
/** Height of each extra "show all" button (mixed nationalities) */
const GROUP_POPUP_BUTTON = 56;
const LIST_MIN_HEIGHT = 60;
const LIST_MAX_HEIGHT = 208;
/** Below this list height the map pans to make room */
const LIST_COMFORT_HEIGHT = 140;

/**
 * Put the group popup on the side of the point with the most room, and cap
 * the list height so the popup (and its buttons) never leave the map.
 */
function groupPopupPlacement(
  map: MapboxMap,
  lngLat: [number, number],
  buttonCount: number,
): GroupPopupPlacement {
  const { x, y } = map.project(lngLat);
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  const below = y < height / 2;
  const space = (below ? height - y : y) - GROUP_POPUP_OFFSET - GROUP_POPUP_TIP_AND_MARGIN;
  const chrome = GROUP_POPUP_CHROME + Math.max(0, buttonCount - 1) * GROUP_POPUP_BUTTON;
  const listMaxHeight = Math.max(LIST_MIN_HEIGHT, Math.min(LIST_MAX_HEIGHT, space - chrome));

  // Too little room (short map, point near the middle): move the point
  // close to the top edge and open the popup below it.
  const panY = space - chrome < LIST_COMFORT_HEIGHT ? Math.round(y - height * 0.15) : 0;

  const half = GROUP_POPUP_WIDTH / 2 + 8;
  const side = x < half ? "-left" : x > width - half ? "-right" : "";
  return { anchor: `${below ? "top" : "bottom"}${side}` as PopupAnchor, listMaxHeight, panY };
}

/** Max authors listed in a popup; the "show all" button covers the rest */
const POPUP_AUTHOR_LIMIT = 50;

/** Cluster circle radius in px: 20 below 10 authors, 30 below 50, else 40 */
const CLUSTER_RADIUS_STEPS = { base: 20, mid: 30, large: 40, midFrom: 10, largeFrom: 50 };
const POINT_RADIUS = 6;
const INTERACTIVE_LAYERS = ["clusters", "unclustered-point"];

function clusterRadius(pointCount: number): number {
  const s = CLUSTER_RADIUS_STEPS;
  return pointCount >= s.largeFrom ? s.large : pointCount >= s.midFrom ? s.mid : s.base;
}

/**
 * Features under a screen point. On the globe projection, Mapbox hit testing
 * misses circles drawn near the horizon, so when nothing is hit, fall back to
 * the drawn circles whose screen radius contains the point.
 */
function featuresAtPoint(map: MapboxMap, point: { x: number; y: number }): GeoJSONFeature[] {
  const hits = map.queryRenderedFeatures(point as PointLike, { layers: INTERACTIVE_LAYERS });
  if (hits.length) return hits;

  const near: { feature: GeoJSONFeature; distance: number }[] = [];
  for (const feature of map.queryRenderedFeatures({ layers: INTERACTIVE_LAYERS })) {
    const coords = (feature.geometry as Point).coordinates;
    const projected = map.project([coords[0], coords[1]]);
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    const radius =
      feature.layer?.id === "clusters"
        ? clusterRadius(Number(feature.properties?.point_count ?? 0))
        : POINT_RADIUS;
    if (distance <= radius + 2) near.push({ feature, distance });
  }
  near.sort((a, b) => a.distance - b.distance);
  if (near.length === 0) return [];
  // A cluster wins on its own; single points keep every overlapping point
  if (near[0].feature.layer?.id === "clusters") return [near[0].feature];
  return near.filter((n) => n.feature.layer?.id === "unclustered-point").map((n) => n.feature);
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
      CLUSTER_RADIUS_STEPS.base,
      CLUSTER_RADIUS_STEPS.midFrom,
      CLUSTER_RADIUS_STEPS.mid,
      CLUSTER_RADIUS_STEPS.largeFrom,
      CLUSTER_RADIUS_STEPS.large,
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
    "circle-radius": POINT_RADIUS,
    "circle-stroke-width": 1,
    "circle-stroke-color": "rgba(255,255,255,0.15)",
  },
};

function lifeYears(birthYear: number | null, deathYear: number | null): string {
  if (birthYear == null) return "";
  return deathYear != null ? `${birthYear}–${deathYear}` : `${birthYear}`;
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
  );
}

interface AuthorsMapProps {
  authors: AuthorMapPoint[];
}

export function AuthorsMap({ authors }: AuthorsMapProps) {
  const mapRef = useRef<MapRef>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, setViewMode] = useLocalStorage<ViewMode>("durtal-authors-view-mode", "grid");
  const [selection, setSelection] = useState<MapSelection | null>(null);
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
        nationalityCode: a.nationalityCode,
        nationalityName: a.nationalityName,
      },
    })),
  };

  /** Open the author list filtered to one nationality (other filters kept). */
  const showNationality = useCallback(
    (code: string) => {
      setSelection(null);
      router.push(withNationalityFilter(searchParams, code));
      // One country is a single dot on the map; the list is the useful view
      setViewMode("grid");
    },
    [router, searchParams, setViewMode],
  );

  // Poster URLs come from the original data, not from the map features,
  // where Mapbox may stringify null values. (`Map` here is the map component.)
  const posterById = useMemo(
    () => new globalThis.Map(authors.map((a) => [a.id, a.posterUrl])),
    [authors],
  );

  /** Show a popup for the authors at one spot (one author or a stack). */
  const selectLeaves = useCallback(
    (leaves: MapAuthorLeaf[]) => {
      const map = mapRef.current?.getMap();
      if (!map || leaves.length === 0) return;
      const [first] = leaves;
      if (leaves.length === 1) {
        setSelection({
          kind: "author",
          author: { ...first, posterUrl: posterById.get(first.id) ?? null },
        });
        return;
      }
      const group = groupMapAuthors(leaves);
      const placement = groupPopupPlacement(
        map,
        [first.longitude, first.latitude],
        group.nationalities.length,
      );
      setSelection({
        kind: "group",
        group,
        latitude: first.latitude,
        longitude: first.longitude,
        placement,
      });
      // The placement is computed again on moveend
      if (placement.panY !== 0) map.panBy([0, placement.panY], { duration: 300 });
    },
    [posterById],
  );

  // Keep the group popup inside the map after the user pans or zooms
  const handleMoveEnd = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    setSelection((current) =>
      current?.kind === "group"
        ? {
            ...current,
            placement: groupPopupPlacement(
              map,
              [current.longitude, current.latitude],
              current.group.nationalities.length,
            ),
          }
        : current,
    );
  }, []);

  const handleMapClick = useCallback(
    (e: MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;

      const features = featuresAtPoint(map, e.point);

      if (!features.length) {
        setSelection(null);
        return;
      }

      const feature = features[0];
      const layerId = feature.layer?.id;

      if (layerId === "clusters") {
        const clusterId = feature.properties?.cluster_id as number | undefined;
        const pointCount = Number(feature.properties?.point_count ?? 0);
        if (clusterId == null) return;

        const source = map.getSource("authors") as GeoJSONSource;
        const geometry = feature.geometry as Point;

        source.getClusterLeaves(clusterId, pointCount, 0, (err, leafFeatures) => {
          const leaves = err || !leafFeatures
            ? []
            : leafFeatures
                .map((f) => leafFromFeature(f as Feature<Point>))
                .filter((l): l is MapAuthorLeaf => l !== null);

          // All authors on one spot (a country centroid): zooming never splits
          // them, so list them instead.
          if (leaves.length > 0 && isSingleSpot(leaves)) {
            selectLeaves(leaves);
            return;
          }

          source.getClusterExpansionZoom(clusterId, (zoomErr, zoom) => {
            if (zoomErr) return;
            setSelection(null);
            map.easeTo({
              center: [geometry.coordinates[0], geometry.coordinates[1]],
              zoom: zoom ?? 8,
              duration: 500,
            });
          });
        });
      } else if (layerId === "unclustered-point") {
        // Past the cluster zoom limit, stacked authors render as overlapping
        // points: take every point under the cursor, not just the top one.
        const leaves = features
          .filter((f) => f.layer?.id === "unclustered-point")
          .map((f) => leafFromFeature(f as Feature<Point>))
          .filter((l): l is MapAuthorLeaf => l !== null);
        const unique = [...new globalThis.Map(leaves.map((l) => [l.id, l])).values()];
        selectLeaves(unique);
      }
    },
    [selectLeaves],
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
        interactiveLayerIds={INTERACTIVE_LAYERS}
        onClick={handleMapClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMoveEnd={handleMoveEnd}
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

        {selection?.kind === "author" && (
          <Popup
            latitude={selection.author.latitude}
            longitude={selection.author.longitude}
            onClose={() => setSelection(null)}
            closeButton={false}
            closeOnClick={false}
            offset={12}
            className="author-map-popup"
          >
            <div
              className="relative min-w-[160px] max-w-[240px] rounded-sm bg-bg-secondary p-3"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-start gap-2">
                {selection.author.posterUrl && (
                  <img
                    src={selection.author.posterUrl}
                    alt={selection.author.name}
                    className="h-12 w-9 flex-shrink-0 rounded-sm object-cover"
                  />
                )}
                <div className="min-w-0 flex-1 pr-3">
                  <Link
                    href={`/authors/${selection.author.slug}`}
                    className="block truncate font-serif text-sm font-medium text-fg-primary hover:text-accent-rose"
                  >
                    {selection.author.name}
                  </Link>
                  {selection.author.locationName && (
                    <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">
                      {selection.author.locationName}
                    </p>
                  )}
                  {selection.author.birthYear != null && (
                    <p className="mt-1 font-mono text-xs text-fg-muted">
                      {lifeYears(selection.author.birthYear, selection.author.deathYear)}
                    </p>
                  )}
                </div>
              </div>
              {selection.author.nationalityCode && selection.author.nationalityName && (
                <button
                  onClick={() => showNationality(selection.author.nationalityCode!)}
                  className="mt-2 block w-full border-t border-glass-border pt-2 text-left text-xs leading-snug text-fg-secondary transition-colors hover:text-accent-rose"
                >
                  {`All authors from ${shortCountryName(selection.author.nationalityName)} \u2192`}
                </button>
              )}
              <CloseButton onClick={() => setSelection(null)} />
            </div>
          </Popup>
        )}

        {selection?.kind === "group" && (
          <Popup
            // The Popup does not apply a changed anchor; remount it instead
            key={selection.placement.anchor}
            latitude={selection.latitude}
            longitude={selection.longitude}
            onClose={() => setSelection(null)}
            closeButton={false}
            closeOnClick={false}
            anchor={selection.placement.anchor}
            offset={GROUP_POPUP_OFFSET}
            maxWidth={`${GROUP_POPUP_WIDTH + 40}px`}
            className="author-map-popup"
          >
            <div
              className="relative rounded-sm bg-bg-secondary p-3"
              style={{ width: GROUP_POPUP_WIDTH, border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="truncate pr-4 font-serif text-sm font-medium text-fg-primary">
                {selection.group.nationalities.length === 1
                  ? selection.group.nationalities[0].name
                  : selection.group.locationName || "Authors here"}
              </p>
              <p className="mt-0.5 font-mono text-xs text-fg-muted">
                {selection.group.authors.length} authors
              </p>

              <ul
                className="mt-2 space-y-0.5 overflow-y-auto border-t border-glass-border pt-2"
                style={{ maxHeight: selection.placement.listMaxHeight }}
              >
                {selection.group.authors.slice(0, POPUP_AUTHOR_LIMIT).map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/authors/${a.slug}`}
                      className="flex items-baseline justify-between gap-2 py-0.5 text-xs text-fg-secondary transition-colors hover:text-accent-rose"
                    >
                      <span className="truncate">{a.name}</span>
                      <span className="flex-shrink-0 font-mono text-[10px] text-fg-muted">
                        {lifeYears(a.birthYear, a.deathYear)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {selection.group.authors.length > POPUP_AUTHOR_LIMIT && (
                <p className="mt-1 font-mono text-[10px] text-fg-muted">
                  + {selection.group.authors.length - POPUP_AUTHOR_LIMIT} more
                </p>
              )}

              {selection.group.nationalities.length > 0 && (
                <div className="mt-3 space-y-1">
                  {selection.group.nationalities.map((n) => (
                    <button
                      key={n.code}
                      onClick={() => showNationality(n.code)}
                      className="block w-full rounded-sm bg-accent-plum/60 px-2 py-1.5 text-left text-xs leading-snug text-fg-primary transition-colors hover:bg-accent-plum"
                    >
                      {`Show all ${n.count} ${n.count === 1 ? "author" : "authors"} from ${shortCountryName(n.name)} \u2192`}
                    </button>
                  ))}
                </div>
              )}
              <CloseButton onClick={() => setSelection(null)} />
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
