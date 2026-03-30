"""Wikidata SPARQL query helpers for author birthplace / deathplace enrichment."""

import re
import time
from dataclasses import dataclass, field

import httpx

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
REQUEST_DELAY = 1.0  # seconds between requests

# Wikidata requires a descriptive User-Agent
USER_AGENT = "DurtalEnrichmentBot/1.0 (book catalogue enrichment; contact: admin@durtal.local)"


@dataclass
class PlaceInfo:
    """A birth/death place returned from Wikidata."""

    wikidata_id: str  # e.g. "Q90"
    name: str
    latitude: float | None = None
    longitude: float | None = None


@dataclass
class WikidataAuthorResult:
    """Enrichment result for a single author."""

    wikidata_id: str
    label: str
    birth_place: PlaceInfo | None = None
    death_place: PlaceInfo | None = None


def _parse_point(coord_str: str | None) -> tuple[float, float] | None:
    """Parse Wikidata Point(lon lat) string into (lat, lon) tuple."""
    if not coord_str:
        return None
    m = re.match(r"Point\(\s*([+-]?\d+\.?\d*)\s+([+-]?\d+\.?\d*)\s*\)", coord_str)
    if not m:
        return None
    lon = float(m.group(1))
    lat = float(m.group(2))
    return (lat, lon)


def _extract_wikidata_id(uri: str | None) -> str | None:
    """Extract Q-identifier from a Wikidata entity URI."""
    if not uri:
        return None
    m = re.search(r"(Q\d+)$", uri)
    return m.group(1) if m else None


def search_author(
    name: str,
    birth_year: int | None = None,
) -> WikidataAuthorResult | None:
    """Query Wikidata for an author's birth/death place info.

    Returns the best match or None if nothing found.
    Rate-limits to one request per second.
    """
    name_lower = name.lower().replace('"', "").replace("'", "")

    # Build optional birth-year filter
    birth_year_filter = ""
    if birth_year:
        # Allow ±2 years tolerance for approximate dates
        birth_year_filter = f"""
  OPTIONAL {{ ?person wdt:P569 ?birthDate }}
  BIND(YEAR(?birthDate) AS ?birthYear)
  FILTER(!BOUND(?birthYear) || (ABS(?birthYear - {birth_year}) <= 2))"""

    sparql = f"""
SELECT DISTINCT
  ?person ?personLabel
  ?birthPlace ?birthPlaceLabel ?birthCoord
  ?deathPlace ?deathPlaceLabel ?deathCoord
WHERE {{
  ?person wdt:P31 wd:Q5 .
  ?person rdfs:label ?name .
  FILTER(LANG(?name) = "en")
  FILTER(CONTAINS(LCASE(?name), "{name_lower}"))
  {birth_year_filter}
  OPTIONAL {{
    ?person wdt:P19 ?birthPlace .
    OPTIONAL {{ ?birthPlace wdt:P625 ?birthCoord . }}
  }}
  OPTIONAL {{
    ?person wdt:P20 ?deathPlace .
    OPTIONAL {{ ?deathPlace wdt:P625 ?deathCoord . }}
  }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en" . }}
}}
LIMIT 5
"""

    headers = {
        "Accept": "application/sparql-results+json",
        "User-Agent": USER_AGENT,
    }
    params = {"query": sparql, "format": "json"}

    time.sleep(REQUEST_DELAY)

    try:
        resp = httpx.get(SPARQL_ENDPOINT, params=params, headers=headers, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"Wikidata HTTP error {exc.response.status_code} for '{name}'") from exc
    except Exception as exc:
        raise RuntimeError(f"Wikidata request failed for '{name}': {exc}") from exc

    bindings = data.get("results", {}).get("bindings", [])
    if not bindings:
        return None

    # Take the first result that has meaningful data
    for b in bindings:
        person_uri = b.get("person", {}).get("value")
        wikidata_id = _extract_wikidata_id(person_uri)
        if not wikidata_id:
            continue

        label = b.get("personLabel", {}).get("value", name)

        birth_place: PlaceInfo | None = None
        bp_uri = b.get("birthPlace", {}).get("value")
        bp_id = _extract_wikidata_id(bp_uri)
        if bp_id:
            bp_label = b.get("birthPlaceLabel", {}).get("value", "")
            bp_coord_str = b.get("birthCoord", {}).get("value")
            bp_coords = _parse_point(bp_coord_str)
            birth_place = PlaceInfo(
                wikidata_id=bp_id,
                name=bp_label,
                latitude=bp_coords[0] if bp_coords else None,
                longitude=bp_coords[1] if bp_coords else None,
            )

        death_place: PlaceInfo | None = None
        dp_uri = b.get("deathPlace", {}).get("value")
        dp_id = _extract_wikidata_id(dp_uri)
        if dp_id:
            dp_label = b.get("deathPlaceLabel", {}).get("value", "")
            dp_coord_str = b.get("deathCoord", {}).get("value")
            dp_coords = _parse_point(dp_coord_str)
            death_place = PlaceInfo(
                wikidata_id=dp_id,
                name=dp_label,
                latitude=dp_coords[0] if dp_coords else None,
                longitude=dp_coords[1] if dp_coords else None,
            )

        # Prefer results that have at least one place
        if birth_place or death_place:
            return WikidataAuthorResult(
                wikidata_id=wikidata_id,
                label=label,
                birth_place=birth_place,
                death_place=death_place,
            )

    # No result with a place — return the first result anyway (partial data)
    b = bindings[0]
    person_uri = b.get("person", {}).get("value")
    wikidata_id = _extract_wikidata_id(person_uri)
    if not wikidata_id:
        return None

    return WikidataAuthorResult(
        wikidata_id=wikidata_id,
        label=b.get("personLabel", {}).get("value", name),
        birth_place=None,
        death_place=None,
    )
