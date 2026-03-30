"""Resolve place names + coordinates to place IDs in the database.

Given a PlaceInfo from Wikidata, this module either finds the existing place
in the `places` table or creates a new one.
"""

from __future__ import annotations

from scripts.enrich.wikidata import PlaceInfo


def resolve_or_create_place(
    cur,
    place: PlaceInfo,
    *,
    dry_run: bool = False,
) -> str | None:
    """Find or create a place row, returning the UUID.

    Lookup order:
    1. Match by wikidata_id (most reliable)
    2. Match by name (case-insensitive)

    If no match and not dry_run, insert a new row.
    Returns the place UUID or None on dry_run.
    """
    if not place or not place.name:
        return None

    # 1. Lookup by wikidata_id
    if place.wikidata_id:
        cur.execute(
            "SELECT id FROM places WHERE wikidata_id = %s",
            (place.wikidata_id,),
        )
        row = cur.fetchone()
        if row:
            return row[0]

    # 2. Lookup by exact name (case-insensitive)
    cur.execute(
        "SELECT id FROM places WHERE LOWER(name) = LOWER(%s)",
        (place.name.strip(),),
    )
    row = cur.fetchone()
    if row:
        # Opportunistically backfill wikidata_id and coordinates if missing
        if not dry_run and place.wikidata_id:
            cur.execute(
                """
                UPDATE places
                SET
                    wikidata_id = COALESCE(wikidata_id, %s),
                    latitude    = COALESCE(latitude,    %s),
                    longitude   = COALESCE(longitude,   %s)
                WHERE id = %s
                """,
                (place.wikidata_id, place.latitude, place.longitude, row[0]),
            )
        return row[0]

    if dry_run:
        return None

    # 3. Determine place type — default to "city" for author birthplaces
    place_type = _infer_place_type(place.name)

    # 4. Try to resolve country_id from coordinates or name
    country_id = _resolve_country_id(cur, place)

    # 5. Insert new place
    cur.execute(
        """
        INSERT INTO places (name, type, wikidata_id, latitude, longitude, country_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id
        """,
        (
            place.name.strip(),
            place_type,
            place.wikidata_id or None,
            place.latitude,
            place.longitude,
            country_id,
        ),
    )
    row = cur.fetchone()
    return row[0] if row else None


def _infer_place_type(name: str) -> str:
    """Heuristic: guess a place type from the name.

    Most author birthplaces from Wikidata are cities/towns.
    """
    name_lower = name.lower()
    if any(w in name_lower for w in ("county", "region", "province", "oblast", "voivodeship")):
        return "region"
    if any(w in name_lower for w in ("state", "canton")):
        return "state"
    if any(w in name_lower for w in ("district", "arrondissement", "borough", "ward")):
        return "district"
    if any(w in name_lower for w in ("village", "hamlet")):
        return "village"
    if any(w in name_lower for w in ("town",)):
        return "town"
    # Default — most Wikidata birthplaces are cities
    return "city"


def _resolve_country_id(cur, place: PlaceInfo) -> str | None:
    """Attempt to resolve a country_id for this place.

    Strategy: if the place name contains a comma-separated final component
    that looks like a country name, try to match it in the countries table.
    Otherwise return None.
    """
    if not place.name:
        return None

    parts = [p.strip() for p in place.name.split(",")]
    if len(parts) < 2:
        return None

    # The last component is most likely the country
    last = parts[-1].strip()
    if not last:
        return None

    cur.execute(
        "SELECT id FROM countries WHERE LOWER(name) = LOWER(%s)",
        (last,),
    )
    row = cur.fetchone()
    if row:
        return row[0]

    # Try prefix match
    cur.execute(
        "SELECT id FROM countries WHERE LOWER(name) LIKE LOWER(%s)",
        (last + "%",),
    )
    row = cur.fetchone()
    return row[0] if row else None
