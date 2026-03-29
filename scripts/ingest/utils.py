"""Shared utilities: slugification, data cleaning."""

import re
import unicodedata


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    if not text:
        return ""
    # Normalize unicode
    text = unicodedata.normalize("NFKD", text)
    # Replace common ligatures / special chars
    text = text.replace("&", "and").replace("+", "plus")
    # Keep only ASCII alphanumerics and spaces/hyphens
    text = re.sub(r"[^\w\s-]", "", text.lower())
    # Collapse whitespace/hyphens
    text = re.sub(r"[-\s]+", "-", text).strip("-")
    return text[:200]  # truncate for safety


def slugify_path(parts: list[str]) -> str:
    """Build a hierarchical slug from path parts, e.g. ['Fiction', 'Literary Fiction'] → 'fiction/literary-fiction'."""
    return "/".join(slugify(p) for p in parts if p)


def clean(val) -> str | None:
    """Trim whitespace, return None for empty/None."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


def clean_int(val) -> int | None:
    """Parse to int or None."""
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def parse_semicolons(val) -> list[str]:
    """Split a semicolon-separated string into trimmed non-empty parts."""
    if not val:
        return []
    return [p.strip() for p in str(val).split(";") if p.strip()]


def parse_roles(val) -> list[str]:
    """Split a role string on both commas and semicolons, handling parenthetical content.

    'Novelist, Playwright' → ['Novelist', 'Playwright']
    'Art Historian; Professor' → ['Art Historian', 'Professor']
    "Author (Children's)" → ["Author (Children's)"]
    """
    if not val:
        return []
    import re
    # First split on semicolons
    parts = []
    for segment in str(val).split(";"):
        segment = segment.strip()
        if not segment:
            continue
        # Split on commas, but not inside parentheses
        sub_parts = re.split(r",\s*(?![^(]*\))", segment)
        for sp in sub_parts:
            sp = sp.strip()
            if sp:
                parts.append(sp)
    return parts


def parse_century(label: str) -> tuple[int, int]:
    """Parse a century label into (start_year, end_year).

    Examples:
        '13th Century' → (1200, 1299)
        '13th/14th Century' → (1200, 1399)
        '21st Century' → (2000, 2099)
    """
    nums = re.findall(r"(\d+)(?:st|nd|rd|th)", label)
    if not nums:
        return (0, 0)
    centuries = [int(n) for n in nums]
    start = (centuries[0] - 1) * 100
    end = centuries[-1] * 100 - 1
    return (start, end)


def extract_goodreads_id(url: str | None) -> str | None:
    """Extract numeric Goodreads ID from a URL or path."""
    if not url:
        return None
    m = re.search(r"/show/(\d+)", str(url))
    if m:
        return m.group(1)
    m = re.search(r"(\d+)", str(url))
    return m.group(1) if m else None


def split_authors(raw: str) -> list[str]:
    """Split a multi-author string into individual 'Surname, Name' entries.

    Handles:
        'Cixous, Hélène & Derrida, Jacques' → ['Cixous, Hélène', 'Derrida, Jacques']
        'Dyachenko, Marina & Sergey' → ['Dyachenko, Marina & Sergey'] (shared surname)
        'Abe, Kōbō' → ['Abe, Kōbō']
    """
    if not raw:
        return []
    # Split on ' & ' but only when followed by a new 'Surname, Name' pattern
    # i.e., there must be a comma after the & segment (indicating a new surname, name pair)
    import re
    # Match ' & ' followed by a word that eventually has a comma (new author)
    parts = re.split(r"\s*&\s*(?=\S+,\s)", raw)
    return [p.strip() for p in parts if p.strip()]


def invert_author_name(sort_name: str) -> str:
    """Convert 'Surname, Name' to 'Name Surname'.

    Also handles single-name authors (no comma).
    """
    if not sort_name or "," not in sort_name:
        return sort_name or ""
    parts = sort_name.split(",", 1)
    return f"{parts[1].strip()} {parts[0].strip()}"
