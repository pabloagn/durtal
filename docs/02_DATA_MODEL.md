# Data Model

Durtal uses a three-tier data model drawn from FRBR (Functional Requirements for Bibliographic Records). The separation between intellectual creation, physical publication, and individual copy is fundamental to the entire system.

---

## Three-Tier Model

```
                  ┌──────────────────────────┐
                  │          WORK             │
                  │  (intellectual creation)  │
                  │                           │
                  │  "Don Quixote"            │
                  │  Original language: es    │
                  │  Original year: 1605      │
                  └──────────┬───────────────┘
                             │ 1:N
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │  EDITION   │  │  EDITION   │  │  EDITION   │
     │ (pub. A)   │  │ (pub. B)   │  │ (pub. C)   │
     │            │  │            │  │            │
     │ Penguin    │  │ Everyman   │  │ Original   │
     │ 2003, EN   │  │ 2020, EN   │  │ 1605, ES   │
     │ ISBN: ...  │  │ ISBN: ...  │  │ ISBN: ...  │
     └──────┬─────┘  └──────┬─────┘  └────────────┘
            │ 1:N           │ 1:N
       ┌────┼────┐     ┌────┘
       ▼         ▼     ▼
  ┌─────────┐ ┌─────────┐ ┌─────────┐
  │INSTANCE │ │INSTANCE │ │INSTANCE │
  │(copy A) │ │(copy B) │ │(copy C) │
  │         │ │         │ │         │
  │Mexico   │ │Calibre  │ │Amsterdam│
  │hardcover│ │epub     │ │hardcover│
  │fine     │ │—        │ │good     │
  └─────────┘ └─────────┘ └─────────┘
```

| Tier | Table | Represents | Carries |
|---|---|---|---|
| **Work** | `works` | The abstract intellectual creation | Canonical title, original language, original year, series, status, rating |
| **Edition** | `editions` | A specific publication | ISBN, publisher, translator, language, page count, binding, dimensions, cover image |
| **Instance** | `instances` | A physical or digital copy at a location | Format, condition, acquisition details, collector flags, status, disposition |

### Why Three Tiers and Not Two

If the schema had only `books` + `instances`, you could not answer "show me all editions I own of Don Quixote" without fuzzy title matching. The `works` table provides a clean grouping key. It also correctly handles: the same ISBN existing in multiple locations (two instances of one edition), multiple translations of the same novel (multiple editions of one work), and the distinction between original publication date (work-level) and this edition's publication date (edition-level).

### Derived Ownership

Ownership status is computed from the data, never stored as a separate field. The `catalogue_status` lives on the **work** because you want or own the *work* — editions and instances are the means.

Given a work W, its editions E[], their instances I[] (excluding deaccessioned), and locations L[]:

```
  IF W.catalogue_status = 'tracked'
    → TRACKED: bibliographic record only, no acquisition intent

  IF W.catalogue_status = 'shortlisted'
    → SHORTLISTED: under consideration for acquisition
    → If instances exist: SHORTLISTED (PARTIALLY HELD)

  IF W.catalogue_status = 'wanted'
    → WANTED: actively seeking to acquire
    → If instances exist: WANTED (PARTIALLY HELD)

  IF W.catalogue_status = 'on_order'
    → ON ORDER: acquisition in progress
    → If instances exist: ON ORDER (PARTIALLY HELD)

  IF W.catalogue_status = 'accessioned'
    → Ownership derived from active instances (status != 'deaccessioned'):
      0 active instances → ACCESSIONED (NO ACTIVE COPIES)
      Physical instances only → OWNED — PHYSICAL
      Digital instances only → OWNED — DIGITAL
      Both → OWNED — PHYSICAL & DIGITAL
    → Location detail: list of locations with instance counts and Calibre URLs for digital

  IF W.catalogue_status = 'deaccessioned'
    → DEACCESSIONED: all copies formally removed, record preserved
    → If active instances exist: INCONSISTENT (data integrity issue)
```

The UI renders ownership as colored location indicators. Each location has an assigned color. On the book card, small dots (or icons) light up for each location that holds an instance.

---

## Entity-Relationship Overview

```
                        ┌──────────┐
                        │  works   │
                        └────┬─────┘
                 ┌───────────┼───────────────────┐
                 │           │                   │
           work_authors  editions          work_subjects
                 │           │                   │
            ┌────┘     ┌─────┼──────┐       ┌────┘
            ▼          ▼     ▼      ▼       ▼
        authors   instances  |   edition   subjects
            │         │      |   _genres
            │    ┌────┘      |      │
            │    ▼           ▼      ▼
            │  locations   edition  genres
            │              _contri-   │
            │              butors     └─→ genres (self-ref)
            │                │
            └────────────────┘
            (edition_contributors → authors)

        ┌──────────┐    ┌──────────────┐    ┌──────────┐
        │  media   │    │  collections │    │  imports  │
        │ (work OR │    │              │    │          │
        │  author) │    │  collection_ │    │          │
        └──────────┘    │  editions    │    └──────────┘
                        └──────────────┘

        ┌──────────┐    ┌──────────────┐    ┌──────────┐
        │  tags    │    │ sub_locations │    │  series  │
        │          │    │              │    │          │
        │ edition_ │    │  → locations │    │ → works  │
        │ tags     │    └──────────────┘    └──────────┘
        └──────────┘
```

---

## Core Tables

### `works`

The abstract intellectual creation. A work exists independently of any particular edition or copy.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `title` | TEXT | NOT NULL | Canonical title of the work |
| `slug` | TEXT | UNIQUE, nullable | Human-readable URL slug (format: `{title}-by-{author}`, with `-2`, `-3`... when taken). Follows the title and primary author: a work rename, a new primary author, an author rename or an author merge refreshes it (`src/lib/works/slug.ts`). Old slugs do not redirect |
| `original_language` | TEXT | NOT NULL, default `'en'` | Language code; stored form set by trigger (see `languages`) |
| `original_year` | SMALLINT | nullable | Year of first publication |
| `description` | TEXT | nullable | Synopsis or summary |
| `series_name` | TEXT | nullable | Series title (deprecated; migrating to `series_id` FK) |
| `series_position` | TEXT | nullable | Position within series (e.g., "1", "2.5") |
| `series_id` | UUID | FK → `series.id`, nullable | Normalized series reference |
| `work_type_id` | UUID | FK → `work_types.id`, nullable | Classification of the work form |
| `is_anthology` | BOOLEAN | NOT NULL, default `false` | Whether the work is an anthology |
| `notes` | TEXT | nullable | Personal notes |
| `rating` | SMALLINT | nullable, 1–5 | Personal rating |
| `catalogue_status` | `catalogue_status_enum` | NOT NULL, default `'tracked'` | Work-level acquisition/ownership status |
| `acquisition_priority` | `acquisition_priority_enum` | NOT NULL, default `'none'` | Urgency of acquisition intent |
| `is_rare` | BOOLEAN | NOT NULL, default `false` | Simple personal rare-book flag; independent of lifecycle/priority and instance collector flags |
| `hunt_assessed_on` | DATE | nullable; required when marked | Calendar date of the latest assessment, editable and defaulted to local today by the UI. Cleared when `is_rare` becomes false; required when true, enforced by a CHECK constraint. |
| `is_poison` | BOOLEAN | NOT NULL, default `false` | Personal warning flag, shown as "Anathema" with a skull: an explicit, transgressive work that is dangerous to recommend. Independent of every other flag. No date; the activity log records changes. |
| `goodreads_url` | TEXT | nullable | Goodreads page for the book. Stored as a canonical `https` URL on `goodreads.com` or a subdomain; validated by the app on write and again before render. Work-level, shared by all editions. |
| `storygraph_url` | TEXT | nullable | The StoryGraph page for the book. Same rules as `goodreads_url`, on `thestorygraph.com` or a subdomain. |
| `metadata_source` | TEXT | nullable | Where metadata was fetched from |
| `metadata_source_id` | TEXT | nullable | ID in the source system |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `editions` (1:N), `workAuthors` (N:M via junction), `workSubjects` (N:M), `media` (1:N), `workRecommenders` (N:M), `workCategories` (N:M), `workLiteraryMovements` (N:M), `workThemes` (N:M), `workArtTypes` (N:M), `workArtMovements` (N:M), `workKeywords` (N:M), `workAttributes` (N:M), `statusHistory` (1:N → `work_status_history`)

---

### `editions`

A specific published form of a work. Carries all publication-level metadata.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `work_id` | UUID | FK → `works.id`, NOT NULL, CASCADE | Parent work |
| `isbn_13` | TEXT | UNIQUE, nullable | ISBN-13 |
| `isbn_10` | TEXT | UNIQUE, nullable | ISBN-10 |
| `asin` | TEXT | nullable | Amazon Standard Identification Number |
| `lccn` | TEXT | nullable | Library of Congress Control Number |
| `oclc` | TEXT | nullable | OCLC number |
| `open_library_key` | TEXT | nullable | Open Library edition key |
| `google_books_id` | TEXT | nullable | Google Books volume ID |
| `goodreads_id` | TEXT | nullable | Goodreads edition ID |
| `title` | TEXT | NOT NULL | Edition title (may differ from work title) |
| `subtitle` | TEXT | nullable | |
| `publisher` | TEXT | nullable | Original/imported publisher text; retained alongside identity links |
| `publisher_links_confirmed` | BOOLEAN | NOT NULL, default false | Protect explicit identity links (including an empty choice) from automatic matching |
| `imprint` | TEXT | nullable | Publishing imprint |
| `publication_date` | DATE | nullable | Exact publication date |
| `publication_year` | SMALLINT | nullable | Publication year |
| `publication_country` | TEXT | nullable | Country of publication |
| `edition_name` | TEXT | nullable | Named edition (e.g., "Everyman's Library") |
| `edition_number` | SMALLINT | nullable | Edition number |
| `printing_number` | SMALLINT | nullable | Print run number |
| `is_first_edition` | BOOLEAN | NOT NULL, default `false` | |
| `is_limited_edition` | BOOLEAN | NOT NULL, default `false` | |
| `limited_edition_count` | INTEGER | nullable | Total copies in limited run |
| `language` | TEXT | NOT NULL, default `'en'` | Language code; stored form set by trigger (see `languages`) |
| `is_translated` | BOOLEAN | NOT NULL, default `false` | |
| `page_count` | INTEGER | nullable | |
| `binding` | TEXT | nullable | See `BINDING_TYPES` enum |
| `height_mm` | SMALLINT | nullable | |
| `width_mm` | SMALLINT | nullable | |
| `depth_mm` | SMALLINT | nullable | |
| `weight_grams` | INTEGER | nullable | |
| `illustration_type` | TEXT | nullable | Type of illustrations |
| `description` | TEXT | nullable | Edition-specific description |
| `table_of_contents` | TEXT | nullable | |
| `cover_s3_key` | TEXT | nullable | S3 key for processed cover (gold/) |
| `thumbnail_s3_key` | TEXT | nullable | S3 key for thumbnail (gold/) |
| `cover_source_url` | TEXT | nullable | Original URL cover was fetched from |
| `metadata_source` | TEXT | nullable | |
| `metadata_last_fetched` | TIMESTAMPTZ | nullable | |
| `metadata_locked` | BOOLEAN | NOT NULL, default `false` | Prevents automated overwrites |
| `notes` | TEXT | nullable | |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `work` (N:1), `instances` (1:N), `contributors` (N:M via junction), `editionGenres` (N:M), `editionTags` (N:M), `collectionEditions` (N:M)

---

### `instances`

A physical or digital copy at a specific location. This is where ownership lives.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `edition_id` | UUID | FK → `editions.id`, NOT NULL, CASCADE | |
| `location_id` | UUID | FK → `locations.id`, NOT NULL, CASCADE | |
| `sub_location_id` | UUID | FK → `sub_locations.id`, nullable, SET NULL | |
| `format` | TEXT | nullable | See `INSTANCE_FORMATS` enum |
| `condition` | TEXT | nullable | See `INSTANCE_CONDITIONS` enum |
| `has_dust_jacket` | BOOLEAN | nullable | |
| `has_slipcase` | BOOLEAN | nullable | |
| `condition_notes` | TEXT | nullable | |
| `is_signed` | BOOLEAN | NOT NULL, default `false` | |
| `signed_by` | TEXT | nullable | |
| `inscription` | TEXT | nullable | Dedication or inscription text |
| `is_first_printing` | BOOLEAN | NOT NULL, default `false` | |
| `provenance` | TEXT | nullable | Ownership history |
| `acquisition_type` | TEXT | nullable | See `ACQUISITION_TYPES` enum |
| `acquisition_date` | DATE | nullable | |
| `acquisition_source` | TEXT | nullable | Store, person, or event |
| `acquisition_price` | NUMERIC(10,2) | nullable | |
| `acquisition_currency` | TEXT | nullable | ISO 4217 code |
| `calibre_id` | INTEGER | nullable | Calibre library ID (digital) |
| `calibre_url` | TEXT | nullable | Deep link to Calibre-Web |
| `file_size_bytes` | BIGINT | nullable | Digital file size |
| `notes` | TEXT | nullable | |
| `status` | `instance_status_enum` | NOT NULL, default `'available'` | Current status of this copy |
| `lent_to` | TEXT | nullable | |
| `lent_date` | DATE | nullable | |
| `disposition_type` | `disposition_type_enum` | nullable | How the copy was disposed of |
| `disposition_date` | DATE | nullable | When disposition occurred |
| `disposition_to` | TEXT | nullable | Recipient of disposition |
| `disposition_price` | NUMERIC(10,2) | nullable | Sale price (if sold) |
| `disposition_currency` | TEXT | nullable | ISO 4217 code |
| `disposition_notes` | TEXT | nullable | Additional disposition details |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `edition` (N:1), `location` (N:1), `subLocation` (N:1, nullable), `statusHistory` (1:N → `instance_status_history`)

---

## Audit Trail Tables

### `work_status_history`

Audit trail for work-level catalogue status changes.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `work_id` | UUID | FK → `works.id`, CASCADE | Parent work |
| `from_status` | `catalogue_status_enum` | nullable | Previous status (null for initial) |
| `to_status` | `catalogue_status_enum` | NOT NULL | New status |
| `changed_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | When the change occurred |
| `notes` | TEXT | nullable | Reason or context for the change |

**Relations**: `work` (N:1)

### `instance_status_history`

Audit trail for instance-level status changes.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK | |
| `instance_id` | UUID | FK → `instances.id`, CASCADE | Parent instance |
| `from_status` | `instance_status_enum` | nullable | Previous status (null for initial) |
| `to_status` | `instance_status_enum` | NOT NULL | New status |
| `changed_at` | TIMESTAMPTZ | NOT NULL, default `NOW()` | When the change occurred |
| `notes` | TEXT | nullable | Reason or context for the change |

**Relations**: `instance` (N:1)

---

### `authors`

Persons who create, translate, edit, or otherwise contribute to works and editions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `name` | TEXT | NOT NULL | Display name ("Gabriel Garcia Marquez") |
| `slug` | TEXT | UNIQUE, nullable | Human-readable URL slug (e.g., `gabriel-garcia-marquez`) |
| `sort_name` | TEXT | nullable | Inverted name for sorting ("Garcia Marquez, Gabriel") |
| `first_name` | TEXT | nullable | Given name |
| `last_name` | TEXT | nullable | Family name |
| `real_name` | TEXT | nullable | Birth name if using a pen name |
| `gender` | gender_enum | nullable | `'male'`, `'female'` |
| `birth_year` | SMALLINT | nullable | |
| `birth_month` | SMALLINT | nullable | |
| `birth_day` | SMALLINT | nullable | |
| `birth_year_is_approximate` | BOOLEAN | default `false` | |
| `birth_year_gregorian` | SMALLINT | nullable | Gregorian calendar year |
| `zodiac_sign` | TEXT | nullable | Auto-computed from birth_month/birth_day (tropical Western zodiac). Values: `aries`, `taurus`, `gemini`, `cancer`, `leo`, `virgo`, `libra`, `scorpio`, `sagittarius`, `capricorn`, `aquarius`, `pisces` |
| `death_year` | SMALLINT | nullable | |
| `death_month` | SMALLINT | nullable | |
| `death_day` | SMALLINT | nullable | |
| `death_year_is_approximate` | BOOLEAN | default `false` | |
| `death_year_gregorian` | SMALLINT | nullable | Gregorian calendar year |
| `nationality_id` | UUID | FK → `countries.id`, SET NULL | |
| `birth_place_id` | UUID | FK → `places.id`, SET NULL | Geographic place of birth |
| `death_place_id` | UUID | FK → `places.id`, SET NULL | Geographic place of death |
| `bio` | VARCHAR(10000) | nullable | |
| `photo_s3_key` | TEXT | nullable | S3 key for author photo |
| `website` | TEXT | nullable | |
| `open_library_key` | TEXT | nullable | |
| `goodreads_id` | TEXT | nullable | |
| `metadata_source` | TEXT | nullable | |
| `metadata_source_id` | TEXT | nullable | |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `search_text` | TEXT | GENERATED ALWAYS (stored) | `search_normalize(name, real_name, sort_name, first_name, last_name)`: accent-free, lower-case, punctuation as spaces. Used by author search only; never written by the app |

**Indexes**: `authors_birth_year_idx` (`birth_year`), `authors_search_text_trgm_idx` (GIN, `search_text gin_trgm_ops`)

**Relations**: `workAuthors` (N:M via junction), `editionContributors` (N:M), `media` (1:N), `authorContributionTypes` (N:M), `birthPlace` (N:1 → `places`), `deathPlace` (N:1 → `places`)

**Search** (migration `0021_author_search`, task 0119):

- Extensions: `unaccent`, `pg_trgm` (schema `public`).
- Function `search_normalize(text) → text` (IMMUTABLE): `unaccent`, strip leftover combining marks, `lower`, collapse punctuation and whitespace to one space. "Péter Nádas" → `peter nadas`. Mirrored in TypeScript by `normalizeSearchText()` (`src/lib/utils/search-text.ts`).
- Match (`src/lib/actions/utils/author-search.ts`): every query word appears in `search_text` (any order); with typo tolerance, a word of 4+ letters may instead have `strict_word_similarity >= 0.4`, and a multi-word query may match as a whole at `>= 0.6`.
- Rank: exact name > name prefix > word prefix > all words as word prefixes > all words anywhere, plus trigram similarity.

---

## Junction Tables

### `work_authors`

Links authors to works as primary creators.

| Column | Type | Constraints |
|---|---|---|
| `work_id` | UUID | FK → `works.id`, CASCADE |
| `author_id` | UUID | FK → `authors.id`, CASCADE |
| `role` | TEXT | NOT NULL, default `'author'` |
| `sort_order` | SMALLINT | NOT NULL, default `0` |

**PK**: `(work_id, author_id, role)`

Roles: `author`, `co_author`

### `edition_contributors`

Links contributors to editions with edition-specific roles (translator, editor, etc.).

| Column | Type | Constraints |
|---|---|---|
| `edition_id` | UUID | FK → `editions.id`, CASCADE |
| `author_id` | UUID | FK → `authors.id`, CASCADE |
| `role` | TEXT | NOT NULL |
| `sort_order` | SMALLINT | NOT NULL, default `0` |

**PK**: `(edition_id, author_id, role)`

Roles: `translator`, `editor`, `illustrator`, `foreword`, `afterword`, `introduction`, `narrator`, `photographer`, `compiler`, `contributor`

**Why separate from `work_authors`**: A translator is not the author of Don Quixote — Cervantes is. The translator's contribution exists only in the context of a specific edition. This separation ensures: (a) searching "books by Borges" returns books Borges *wrote*, not books he merely translated; (b) the edition detail page can show "Translated by X, Introduction by Y" distinctly from "Written by Z"; (c) the same person can be author of one work and translator of another without role confusion.

### `work_subjects`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `subject_id` | UUID FK → `subjects.id`, CASCADE |

**PK**: `(work_id, subject_id)`

### `edition_genres`

| Column | Type |
|---|---|
| `edition_id` | UUID FK → `editions.id`, CASCADE |
| `genre_id` | UUID FK → `genres.id`, CASCADE |

**PK**: `(edition_id, genre_id)`

### `edition_tags`

| Column | Type |
|---|---|
| `edition_id` | UUID FK → `editions.id`, CASCADE |
| `tag_id` | UUID FK → `tags.id`, CASCADE |

**PK**: `(edition_id, tag_id)`

### `collection_editions`

| Column | Type | Constraints |
|---|---|---|
| `collection_id` | UUID | FK → `collections.id`, CASCADE |
| `edition_id` | UUID | FK → `editions.id`, CASCADE |
| `sort_order` | INTEGER | NOT NULL, default `0` |
| `added_at` | TIMESTAMPTZ | NOT NULL, auto |

**PK**: `(collection_id, edition_id)`

### `work_categories`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `category_id` | UUID FK → `book_categories.id`, CASCADE |

**PK**: `(work_id, category_id)`

### `work_literary_movements`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `literary_movement_id` | UUID FK → `literary_movements.id`, CASCADE |

**PK**: `(work_id, literary_movement_id)`

### `work_themes`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `theme_id` | UUID FK → `themes.id`, CASCADE |

**PK**: `(work_id, theme_id)`

### `work_art_types`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `art_type_id` | UUID FK → `art_types.id`, CASCADE |

**PK**: `(work_id, art_type_id)`

### `work_art_movements`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `art_movement_id` | UUID FK → `art_movements.id`, CASCADE |

**PK**: `(work_id, art_movement_id)`

### `work_keywords`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `keyword_id` | UUID FK → `keywords.id`, CASCADE |

**PK**: `(work_id, keyword_id)`

### `work_attributes`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `attribute_id` | UUID FK → `attributes.id`, CASCADE |

**PK**: `(work_id, attribute_id)`

### `author_contribution_types`

| Column | Type |
|---|---|
| `author_id` | UUID FK → `authors.id`, CASCADE |
| `contribution_type_id` | UUID FK → `contribution_types.id`, CASCADE |

**PK**: `(author_id, contribution_type_id)`

### `publishing_house_specialties`

| Column | Type |
|---|---|
| `publishing_house_id` | UUID FK → `publishing_houses.id`, CASCADE |
| `specialty_id` | UUID FK → `publisher_specialties.id`, CASCADE |

**PK**: `(publishing_house_id, specialty_id)`

---

## Reference Tables

### `languages`

Normalized language reference data. ISO 639-1/2/3 compliant.

**Stored language codes** (migration 0035): `editions.language` and `works.original_language` hold one form per language: the ISO 639-1 code when the language has one (`en`), otherwise ISO 639-3 (`grc`). The function `language_code(text)` resolves any code of a `languages` row (639-2 B or T: `fre`, `fra`), a regional tag (`en-US`, `en_GB`) or the English name (`English`), case-insensitively; it returns NULL for unknown values and for values that name two languages. BEFORE INSERT/UPDATE triggers on both columns store the resolved code. A value the table does not know is kept only when it already has the form of a code (2–3 lowercase letters), so a database without reference data still accepts codes; other text is rejected (`check_violation`). The app shows English names (`src/lib/utils/language.ts`).

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `iso_639_1` | VARCHAR(5) | UNIQUE |
| `iso_639_2` | VARCHAR(10) | |
| `iso_639_3` | VARCHAR(5) | |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Indexed on: `name`, `iso_639_1`. Seeded from Knowledge_Base (448 rows).

### `countries`

Normalized country/continent reference. ISO 3166 compliant.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `alpha_2` | VARCHAR(2) | UNIQUE |
| `alpha_3` | VARCHAR(3) | UNIQUE |
| `numeric_code` | SMALLINT | |
| `continent_name` | TEXT | |
| `continent_code` | VARCHAR(2) | |
| `latitude` | DOUBLE PRECISION | nullable | Geographic centroid latitude |
| `longitude` | DOUBLE PRECISION | nullable | Geographic centroid longitude |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Indexed on: `name`, `alpha_2`, `alpha_3`, `continent_name`. Seeded from Knowledge_Base (262 rows).

### `places`

Hierarchical geographic locations. Used to record birth and death places for authors. Supports arbitrary depth (country → region → city → district → neighborhood) via a self-referential parent FK.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `name` | TEXT | NOT NULL | Short place name (e.g., "Paris") |
| `full_name` | TEXT | nullable | Precomputed full path (e.g., "Paris, Île-de-France, France") |
| `type` | TEXT | NOT NULL | `country`, `region`, `state`, `province`, `city`, `town`, `village`, `district`, `neighborhood` |
| `parent_id` | UUID | FK → `places.id`, SET NULL, self-ref | Parent in hierarchy |
| `country_id` | UUID | FK → `countries.id`, SET NULL | Shortcut to country for fast filtering |
| `latitude` | DOUBLE PRECISION | nullable | |
| `longitude` | DOUBLE PRECISION | nullable | |
| `geoname_id` | INTEGER | nullable | GeoNames database ID |
| `wikidata_id` | TEXT | nullable | Wikidata entity ID (e.g., Q90 for Paris) |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `parent` (N:1 → `places`, self-ref), `children` (1:N → `places`, self-ref), `country` (N:1 → `countries`)

### `centuries`

Era classification for temporal context.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `label` | TEXT | UNIQUE, NOT NULL |
| `start_year` | SMALLINT | |
| `end_year` | SMALLINT | |
| `sort_order` | SMALLINT | |

Seeded from Knowledge_Base (14 values: 13th through 21st century, including cross-century spans).

### `work_types`

Classification of work forms (novel, poetry, essay, etc.).

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `description` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (34 rows).

### `contribution_types`

Formalized creator roles beyond work_author and edition_contributor.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `description` | TEXT | nullable |
| `applicable_work_types` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (50 rows).

### `sources`

External platforms and reference URLs.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `url` | TEXT | nullable |
| `description` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (14 rows).

### `series`

Normalized book series (replaces the text `series_name` field on works).

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `title` | TEXT | NOT NULL |
| `original_title` | TEXT | nullable |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `description` | TEXT | nullable |
| `total_volumes` | SMALLINT | nullable |
| `is_complete` | BOOLEAN | default `false` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto |

Indexed on: `title` (GIN trigram), `slug` (B-tree). Seeded from Knowledge_Base (153 rows).

### `recommenders`

People or channels who recommended a work. Many-to-many with works via `work_recommenders`.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `url` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto |

### `work_recommenders`

| Column | Type |
|---|---|
| `work_id` | UUID FK → `works.id`, CASCADE |
| `recommender_id` | UUID FK → `recommenders.id`, CASCADE |

**PK**: `(work_id, recommender_id)`

### `publishing_houses`

Stable publisher identities, including explicitly related imprints. Names are **not unique**: unrelated houses can share a name. Country and website help a person distinguish them. Slugs remain unique and stable across renames.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL; indexed, not unique |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `country` | TEXT | nullable |
| `country_id` | UUID | FK → `countries.id`, SET NULL |
| `kind` | TEXT | NOT NULL, default publisher; `group`, `publisher` or `imprint` |
| `parent_id` | UUID | FK → publishing_houses.id, RESTRICT; an imprint's publisher (required), a publisher's group (optional), NULL for a group |
| `is_favourite` | BOOLEAN | NOT NULL, default false |
| `notes` | TEXT | Personal collecting notes, nullable |
| `description` | TEXT | nullable |
| `website` | TEXT | nullable; web writes accept HTTP(S) URLs |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Three levels, as the book trade uses them (migration 0036, task 0179): a **group** owns publishers (Penguin Random House), a **publisher** owns imprints (Knopf Doubleday Publishing Group), and an **imprint** is the brand printed on the book (Vintage International). ONIX for Books keeps imprint and publisher apart; library cataloguing records the imprint. A trigger allows only imprint → publisher → group parents; types and parents may change when ownership changes, as long as the houses below still fit, and every change is logged in `publisher_hierarchy_changes`. Books stay on their imprint, so a move does not rewrite them. `publisher_family(root)` returns a house and every house below it; publisher pages, counts, the library publisher filter and `target_accepts_edition` roll up through it. The approved structure and its evidence rules live in `src/lib/publishers/taxonomy.ts` and are applied by `scripts/publishers/taxonomy.ts` (dry run by default). Sellers remain `venues`, not publisher identities.

### `publisher_aliases`

`publisher_id` (UUID, FK → publishing_houses, CASCADE) and `name` (TEXT, NOT NULL), composite PK. The same alias may belong to different houses; such a match is ambiguous. Aliases are explicitly maintained on publisher profiles.

### `edition_publishers`

`edition_id` (UUID, FK → editions, CASCADE) and `publisher_id` (UUID, FK → publishing_houses, RESTRICT), composite PK; publisher lookup index. Supports co-publishing and imprint associations without duplicated editions. Parent views include directly linked imprints; an imprint view does not include siblings. All counts de-duplicate edition/work IDs.

Migration 0025 adds exact matching at the database boundary for web, API and Python writes. `publisher_name_key` trims and collapses whitespace, then lowercases. Only one globally unique name/alias candidate links automatically. No fuzzy matching, inferred imprint membership, or source-text rewrites. Publisher/alias changes recompute unconfirmed links, including removing links that become ambiguous. `set_edition_publishers` locks the edition and atomically replaces links; `publisher_links_confirmed` prevents imports/rematching from altering them. The review page identifies unmatched or ambiguous nonempty source fields; missing text remains unknown.

Migration 0034 extends the matching. Names in `ignored_publisher_names` are skipped. When neither the publisher nor the imprint text identifies exactly one house, the longest `publisher_isbn_prefixes` rule that starts the edition's ISBN links it (`edition_isbn_digits` reads `isbn_13`, or `978` + the first nine digits of `isbn_10`). ISBN changes now recompute an edition's links, and rule or ignored-name changes recompute every unconfirmed edition. Name matches always win over ISBN rules.

Migration 0036 adds three rules. A name that several houses carry (Vintage in the UK, Vintage Books in the US, each with the other's spelling as an alias) links to the one whose family holds an ISBN rule for the edition. After matching, only the most specific house stays: an edition that names both Penguin and Penguin Classics links to the imprint alone. A transaction that sets `durtal.defer_publisher_refresh = 'on'` skips the per-statement recomputation and calls `refresh_all_publisher_links()` once.

The publisher names inbox (`/publishers/review`, `src/lib/actions/publisher-names.ts`) groups unconfirmed editions without a house by publisher/imprint text (`publisher_name_key`). It suggests a house by similar name (company words, accents, punctuation and parentheses removed; aliases included) and by ISBN publisher prefix (`isbn3` ranges; linked books of exactly one house share the prefix). One decision applies to every edition with the name: link (saves an alias; an ambiguous name, or an ISBN-only suggestion, confirms each edition instead), create a house, or mark the name as not a publisher. Saving the editions' ISBN prefixes as rules is optional; it is skipped for a prefix that books of another house already use.

### `publisher_isbn_prefixes`

| Column | Type | Constraints |
|---|---|---|
| `prefix` | TEXT | PK; CHECK `^97[89][0-9]{2,10}$` (digits of GS1 prefix, group and registrant, e.g. `978159017`) |
| `publisher_id` | UUID | NOT NULL, FK → `publishing_houses.id`, CASCADE; indexed |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Edited as "ISBN prefixes" on publisher profiles (hyphens allowed on input) and saved from the inbox.

### `ignored_publisher_names`

| Column | Type | Constraints |
|---|---|---|
| `name_key` | TEXT | PK; CHECK `name_key = publisher_name_key(name)` |
| `name` | TEXT | NOT NULL; display spelling |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Publisher text that names no publisher (a distributor or a printer). Such text never matches a house; the edition's ISBN rule still applies. Restored from the inbox.

### `publisher_hierarchy_changes`

`id` (UUID PK), `publisher_id` (UUID, FK → publishing_houses, CASCADE; indexed), `old_kind`, `new_kind` (TEXT, NOT NULL), `old_parent_id`, `new_parent_id` (UUID, no FK: history), `changed_at` (TIMESTAMPTZ). A row per change of a house's type or parent, written by trigger.

### `edition_enrichments`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `run_id` | UUID | NOT NULL; indexed; one taxonomy run |
| `edition_id` | UUID | NOT NULL, FK → `editions.id`, CASCADE; indexed |
| `field` | TEXT | NOT NULL; CHECK `imprint` or `publication_country` |
| `old_value` | TEXT | nullable |
| `new_value` | TEXT | NOT NULL |
| `source` | TEXT | NOT NULL; `open_library` or `isbn_or_place` |
| `evidence` | TEXT | NOT NULL; what the source said |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |
| `undone_at` | TIMESTAMPTZ | nullable |

Edition fields filled from a second source. An imprint is written only when Open Library names a house of the taxonomy and the edition's ISBN prefix belongs to that house's publisher (or, for divisions that share prefixes, its group), and only into an empty field. The country comes from the place of publication, or from a prefix used in one market only; existing values are never overwritten. `--undo RUN_ID` restores a run's values where they are unchanged.

### `publisher_auto_decisions`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name_key` | TEXT | NOT NULL, UNIQUE (`publisher_name_key` of the name) |
| `name` | TEXT | NOT NULL; the source spelling |
| `action` | TEXT | NOT NULL; CHECK `alias` or `create` |
| `publisher_id` | UUID | FK → `publishing_houses.id`, SET NULL; indexed |
| `reason` | TEXT | NOT NULL; the evidence shown to the reader |
| `edition_count` | INTEGER | NOT NULL; editions that carried the name then |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |
| `undone_at` | TIMESTAMPTZ | nullable |

Log of automatic publisher decisions (`src/lib/publishers/resolution.ts`). When an edition is created, rematched or edited (publisher, imprint or ISBN), and from the inbox's "Apply safe decisions", a name without a house is decided only when it is safe:
- **alias**: exactly one house has a similar loose name, the ISBNs point at no other house, the name passes the guardrails and the edition titles match their works;
- **create**: no house is similar or related (shared two-word phrase or distinctive first word), every edition has a valid ISBN that no house uses, the name spans at most two ISBN publishers, no other new name shares its ISBN, spellings of one new name share one house, close new names are held, the name passes the guardrails and the titles match. The house gets the cleaned name ("Dedalus" for "Dedalus Limited"); the source spelling becomes its alias. At most 20 houses per 24 hours on the add-a-book path.

Guardrails hold placeholders, print-on-demand platforms, distributors and parent labels, cut-off or multi-name text, web addresses, numbers and names equal to the book's author. Automatic decisions never save ISBN rules. Undo removes the alias, or deletes the created house with its automatic links while nothing else depends on it (no confirmed links, targets, imprints, rules, specialties or added details, and not a merge survivor). A name with a logged decision, undone or not, is never decided automatically again.

### `acquisition_targets`

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, auto |
| `work_id` | UUID | NOT NULL, FK → works, CASCADE |
| `edition_id` | UUID | nullable, FK → editions, RESTRICT |
| `publisher_id` | UUID | nullable, FK → publishing_houses, RESTRICT |
| `is_cancelled` | BOOLEAN | NOT NULL, default false |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Both optional IDs NULL means **any edition**; a publisher ID means a publisher preference; an edition ID means an exact edition. CHECK prevents both IDs being populated. Partial unique index prevents duplicate active targets, including the NULL cases. A trigger validates the edition's work; target identity is immutable. Existing targets can be removed only when no non-cancelled/non-returned orders depend on them.

Target state is derived, not independently stored: cancelled; received through an explicitly linked matching order or active matching copy; on order; otherwise wanted. Receiving another publisher's edition cannot fulfil a target. Returns or disposal of its only linked copy reopen it. Work ownership still derives from copies: owning one edition and wanting another coexist. Library Wanted/On order filters include matching acquisition targets while preserving the work's stored status.

### `acquisition_target_copies`

`target_id` UUID PK (FK → acquisition_targets, CASCADE), `instance_id` UUID NOT NULL (FK → instances, CASCADE; indexed). Introduced in migration 0026 for explicit fulfilment by a copy accessioned without an order. The trigger rejects copies of the wrong work, edition or publisher and deaccessioned copies. Moving a linked copy to an incompatible edition is rejected. Deleting or deaccessioning the copy removes its contribution to fulfilment.

### `publisher_specialties`

Publishing focus areas (e.g., "Academic Publishing", "Literary Fiction").

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (163 rows).

---

## Taxonomy Tables

### `subjects`

Work-level thematic classification. Flat list.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `description` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (238 rows).

### `genres`

Edition-level publishing categories. Self-referential hierarchy.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `parent_id` | UUID | FK → `genres.id`, SET NULL |
| `sort_order` | INTEGER | NOT NULL, default `0` |

### `tags`

User-defined labels applied to editions.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `color` | TEXT | nullable, hex code |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

### `book_categories`

Structured 3-level hierarchy for work classification.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `level` | SMALLINT | NOT NULL, 1–3 |
| `parent_id` | UUID | FK → `book_categories.id`, CASCADE |
| `scope_notes` | TEXT | nullable |
| `sort_order` | INTEGER | default `0` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

**Unique**: `(parent_id, name)`. Indexed on: `name`, `slug`, `parent_id`, `level`.

Hierarchy example:
```
Level 1: Fiction
  Level 2: Literary Fiction
    Level 3: Modernist
```

Seeded from Knowledge_Base (825 rows).

### `literary_movements`

3-level hierarchy of literary movements and periods.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `level` | SMALLINT | NOT NULL, 1–3 |
| `parent_id` | UUID | FK → self, SET NULL |
| `scope_notes` | TEXT | nullable |
| `sort_order` | INTEGER | default `0` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

**Unique**: `(parent_id, name)`. Seeded from Knowledge_Base (217 rows).

### `themes`

3-level hierarchy of thematic concerns.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `level` | SMALLINT | NOT NULL, 1–3 |
| `parent_id` | UUID | FK → self |
| `sort_order` | INTEGER | default `0` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

**Unique**: `(parent_id, name)`. Seeded from Knowledge_Base (567 rows).

### `art_types`

Art form classification applicable to literary works.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `description` | TEXT | nullable |
| `applicable_work_types` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (170 rows, filtered to literature-related types).

### `art_movements`

Art movement classification.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (86 rows).

### `keywords`

Free-form descriptors for works.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (287 rows).

### `attributes`

Stylistic and tonal descriptors with category grouping.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `description` | TEXT | nullable |
| `category` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Indexed on: `name`, `category`. Seeded from Knowledge_Base (70 rows).

---

## Location & Organization Tables

### `locations`

Physical or digital storage locations.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `type` | TEXT | NOT NULL (`'physical'` or `'digital'`) |
| `street` | TEXT | nullable |
| `city` | TEXT | nullable |
| `region` | TEXT | nullable |
| `country` | TEXT | nullable |
| `country_code` | TEXT | nullable, ISO 3166-1 alpha-2 |
| `postal_code` | TEXT | nullable |
| `latitude` | DOUBLE PRECISION | nullable |
| `longitude` | DOUBLE PRECISION | nullable |
| `icon` | TEXT | nullable |
| `color` | TEXT | nullable |
| `sort_order` | INTEGER | NOT NULL, default `0` |
| `is_active` | BOOLEAN | NOT NULL, default `true` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Default locations seeded during ingestion:

| Name | Type |
|---|---|
| Mexico City | physical |
| Amsterdam | physical |
| Calibre | digital |
| Kindle | digital |
| iPad | digital |
| iPhone | digital |

### `sub_locations`

Nested subdivisions within a location (shelf, drawer, room).

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `location_id` | UUID | FK → `locations.id`, CASCADE |
| `name` | TEXT | NOT NULL |
| `sort_order` | INTEGER | NOT NULL, default `0` |

### `collections`

User-curated groups of editions. Poster and background images are rows in `media` with `collection_id` set (migration `0029_collection_media`), managed like work images: several per type, one active, crop and adjustments. The former `cover_s3_key`, `poster_s3_key`, `poster_thumbnail_s3_key` and `background_s3_key` columns were moved into `media` and dropped by that migration. Grids and cards show the active poster; the collection page shows the active background as its banner.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | nullable |
| `icon` | TEXT | nullable; a Lucide icon name (PascalCase key of `lucide-react` `icons`, e.g. `BookOpen`), checked by the app on write. Shown beside the collection name. |
| `sort_order` | INTEGER | NOT NULL, default `0` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto |

---

## Media & Import Tables

### `media`

Images attached to works, authors or collections. Polymorphic ownership.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `work_id` | UUID | FK → `works.id`, CASCADE, nullable |
| `author_id` | UUID | FK → `authors.id`, CASCADE, nullable |
| `collection_id` | UUID | FK → `collections.id`, CASCADE, nullable (migration `0029_collection_media`) |
| `type` | TEXT | NOT NULL (`'poster'`, `'background'`, `'gallery'`; collections use poster and background only) |
| `s3_key` | TEXT | NOT NULL |
| `thumbnail_s3_key` | TEXT | nullable |
| `original_filename` | TEXT | nullable |
| `mime_type` | TEXT | nullable |
| `width` | INTEGER | nullable |
| `height` | INTEGER | nullable |
| `size_bytes` | INTEGER | nullable |
| `is_active` | BOOLEAN | NOT NULL, default `true`. For poster/background: only one active per owner+type. For gallery: always true. |
| `crop_x` | REAL | NOT NULL, default `50`. Horizontal focal-point percentage (0-100) for CSS `object-position` on the display file. |
| `crop_y` | REAL | NOT NULL, default `50`. Vertical focal-point percentage (0-100) for CSS `object-position` on the display file. |
| `crop_zoom` | REAL | NOT NULL, default `100`. Legacy CSS zoom (`transform: scale()`). A saved crop always sets it to `100`: the zoom is in the file. |
| `uncropped_s3_key` | TEXT | nullable (migration `0033_media_applied_crop`). The full-size image before the crop. Never modified. Set when `s3_key` and `thumbnail_s3_key` hold a cropped image. |
| `applied_crop` | JSONB | nullable (migration `0033_media_applied_crop`). `{ x, y, zoom }`: the editor crop that the display files hold, relative to `uncropped_s3_key`. |
| `brightness` | REAL | NOT NULL, default `100`. Display brightness percentage (100 = unchanged; editor range 0-200). Applied as CSS `filter: brightness()`. |
| `contrast` | REAL | NOT NULL, default `100`. Display contrast percentage (100 = unchanged; editor range 0-200). Applied as CSS `filter: contrast()`. |
| `original_s3_key` | TEXT | nullable. S3 key for the pre-processing color original. Set only for author media with monochrome processing. |
| `processing_params` | JSONB | nullable. Monochrome processing parameters: `{ grayscale: true, contrast: number, sharpness: number, gamma: number, brightness: number }`. Author media only. |
| `color_palette` | JSONB | nullable. Extracted color palette for poster images. Contains raw Vibrant swatches (vibrant, muted, darkVibrant, darkMuted, lightVibrant, lightMuted), dominant color from sharp stats, and a post-processed `crystal` array of 3-4 colors ready for ambient rendering. Extracted at upload time via node-vibrant. |
| `sort_order` | SMALLINT | NOT NULL, default `0` |
| `caption` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

**Check constraint** `media_owner_check`: `num_nonnulls(work_id, author_id, collection_id) = 1` — exactly one owner.

**Check constraint** `media_applied_crop_check`: `num_nonnulls(uncropped_s3_key, applied_crop) in (0, 2)` — both set, or neither.

**Indexes**: `(work_id, type, is_active)`, `(author_id, is_active)`, `(collection_id, type, is_active)`.

**Active selection**: Multiple posters/backgrounds can exist for a work, but only one is active at a time. Uploading a new poster deactivates the previous one (without deleting it). Users can switch the active poster/background or permanently delete unwanted items.

**Crop** (migration `0033_media_applied_crop`, task 0155): the crop is in the image files, so every view shows it (cards, lists, timelines, map popups, lightboxes, thumbnails). Saving a crop in the editor (`src/lib/media/display.ts`) writes a cropped full image and thumbnail to new keys, points `s3_key` / `thumbnail_s3_key` at them, and keeps the image before the crop at `uncropped_s3_key`. The editor always crops from `uncropped_s3_key`. Reset points `s3_key` back at the uncropped image. The crop is the rectangle the editor frame shows (2:3 for posters, 16:9 for backgrounds): `cropRegion()` in `src/lib/media/crop.ts`.

Safety rules: the uncropped image and `original_s3_key` are never modified; each new version uses fresh keys (no object is overwritten); the row is swapped in one transaction only when it is unchanged since it was read; replaced files are deleted after the swap and only when no row references them (`src/lib/s3/references.ts`, also used by media delete and collection cleanup). Display settings in `image_adjustments` follow the image to its new key.

After a crop, `crop_x` / `crop_y` keep its focal point and `crop_zoom` is `100`. Views of another shape (wide banners, square avatars) then show the chosen part, and `object-position` only moves the image inside the cropped file. A crop that cuts nothing (the frame's own aspect, no zoom) writes no file. Crops saved before task 0155 as CSS framing were moved into files by `POST /api/media/apply-crops`.

**Brightness and contrast** (migration `0022_media_brightness_contrast`, task 0116): `brightness` and `contrast` work like the crop fields: CSS-only (`filter: brightness() contrast()`), edited with two sliders in the same editor, never written to S3. Every render site builds its style through `mediaImageStyle()` (`src/lib/utils/media-style.ts`), which adds the crop only when it differs from the default and the filter only when a value differs from 100. Not the same as the author monochrome `processing_params` below, which rewrites the S3 image.

**Author monochrome processing**: Author images are automatically processed through a grayscale + normalization pipeline. The original color image is stored in `original_s3_key`, and the processed monochrome variant is stored in `s3_key`. Processing parameters are configurable per media item via `processing_params`, allowing per-image tuning of contrast, sharpness, gamma, and brightness. Re-processing fetches the original and applies new parameters without quality loss. It writes new files and applies the saved crop again: the new monochrome image becomes `uncropped_s3_key`.

**Color palette extraction**: For poster images (`type = 'poster'`), a color palette is extracted at upload time using node-vibrant. The multi-pass algorithm extracts six semantic swatches (Vibrant, Muted, DarkVibrant, DarkMuted, LightVibrant, LightMuted) and the dominant color via sharp stats. These are then processed through a crystal pipeline that enforces diversity (delta-E > 25 between selected colors), clamps saturation/lightness to the design language bounds (S: 12-65%, L: 18-45%), and assigns 3-4 roles (primary, secondary, accent, halo) with per-color opacity recommendations (0.08-0.18). The resulting `crystal` array drives the ambient color crystallization effect on book detail pages.

### `image_adjustments`

Shared display-only settings for stored image assets (migration `0027_shared_image_adjustments`). The table starts empty; existing media, files, crops, and defaults are unchanged.

| Column | Type | Constraints |
|---|---|---|
| `asset_key` | TEXT | PK, canonical full-image S3 key |
| `sources` | JSONB | NOT NULL, canonical app URLs for full image, thumbnail and optional Reader cover route |
| `settings` | JSONB | NOT NULL, validated exposure, brightness, contrast, saturation, grayscale, sepia and softness |
| `monochrome` | BOOLEAN | NOT NULL, default false; derived from author ownership by the server |
| `updated_at` | TIMESTAMPTZ | NOT NULL, default now() |

Exposure uses stops (-2 to +2); brightness/contrast/saturation use 0–200% with neutral 100%; grayscale/sepia use 0–100% with neutral 0%; softness uses 0–8px with neutral 0. Author assets force grayscale 100%, saturation 100%, and sepia 0, including Reset. Color originals used by the existing author processing pipeline are not editable through this feature.

A single shared editor resolves registered assets from media, editions, author photos, venues, collections, image attachments and Calibre covers. The app provider applies the same filter as the preview to exact asset URLs across cards, lightboxes and thumbnails. Only explicitly saved images receive rules. Preview images opt out to avoid double application. For media, existing brightness/contrast values seed the editor and are synchronized atomically on save; framed posters/backgrounds retain their crop controls. Gallery and other images receive filters without introducing unsupported cropping. Originals and extracted ambient palettes are never rewritten. Reset restores neutral display settings, not the pre-processing color original.

Collection posters, backgrounds and distinct legacy covers have separate identities. Entries are keyed by image identity rather than entity ID: replacing an image with a new S3 key starts neutral; deleting a file leaves harmless display metadata whose exact URLs no longer render. Settings are internal presentation metadata and are not baked into exported/downloaded files.

### `gallery_layouts`

Pre-computed collage grid layout specifications for gallery media on work and author detail pages. Stores the result of the layout algorithm so layouts are deterministic and do not need to be recomputed on every page view.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `entity_type` | TEXT | NOT NULL | `'work'` or `'author'` |
| `entity_id` | UUID | NOT NULL | ID of the owning work or author |
| `layout_data` | JSONB | NOT NULL | Computed `CollageLayoutData` JSON: `{ blocks: CollageBlock[] }` where each block has `columns`, `rows`, and `cells` (with `mediaId`, `row`, `col`, `rowSpan`, `colSpan`) |
| `seed` | INTEGER | NOT NULL, default `0` | Integer seed used for deterministic template selection — same seed produces the same layout |
| `image_count` | INTEGER | NOT NULL, default `0` | Number of gallery images at time of last computation; used to detect staleness |
| `container_width` | INTEGER | nullable | Pixel width of the gallery container at time of last computation; used to detect layout staleness when the container is resized |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Unique constraint**: `(entity_type, entity_id)` — one layout record per entity.

**Staleness detection**: The `image_count` field is compared against the current count of `media` rows with `type = 'gallery'` for the entity. If they differ, the layout is recomputed before rendering. The existing `seed` is reused to preserve the current visual arrangement where possible.

**Randomization**: A "Shuffle" button in the gallery UI calls `randomizeLayout()`, which generates a new random seed and recomputes the layout, storing the new result.

### `imports`

Tracks bulk import operations through the medallion pipeline.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `source` | TEXT | NOT NULL |
| `status` | TEXT | NOT NULL, default `'pending'` |
| `s3_bronze_key` | TEXT | nullable |
| `s3_silver_key` | TEXT | nullable |
| `total_records` | INTEGER | nullable |
| `processed_records` | INTEGER | NOT NULL, default `0` |
| `skipped_records` | INTEGER | NOT NULL, default `0` |
| `error_records` | INTEGER | NOT NULL, default `0` |
| `error_log` | JSONB | nullable |
| `started_at` | TIMESTAMPTZ | nullable |
| `completed_at` | TIMESTAMPTZ | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

---

## Provenance Tables

### `orders`

Tracks the acquisition pipeline for individual works — from intent to receipt. Links a work to a venue, shipping details, cost breakdown, and destination location.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `work_id` | UUID | FK → `works.id`, CASCADE, NOT NULL | The work being acquired |
| `acquisition_target_id` | UUID | nullable, FK → acquisition_targets, RESTRICT | Optional collecting target; database validates work, edition and copy compatibility |
| `edition_id` | UUID | FK → `editions.id`, SET NULL, nullable | Specific edition ordered (if known) |
| `instance_id` | UUID | FK → `instances.id`, SET NULL, nullable | Resulting instance once received |
| `venue_id` | UUID | FK → `venues.id`, SET NULL, nullable | Venue / seller from which the order was placed |
| `acquisition_method` | `acquisition_method_enum` | NOT NULL | How the work is being acquired |
| `status` | `order_status_enum` | NOT NULL, default `'placed'` | Current stage in the acquisition pipeline |
| `order_date` | DATE | NOT NULL | Date the order was placed or acquisition initiated |
| `order_confirmation` | TEXT | nullable | Confirmation or reference number |
| `order_url` | TEXT | nullable | URL to the order page |
| `price` | NUMERIC(10,2) | nullable | Item price (before shipping) |
| `shipping_cost` | NUMERIC(10,2) | nullable | Shipping cost |
| `total_cost` | NUMERIC(10,2) | nullable | Total cost (price + shipping) |
| `currency` | TEXT | nullable | ISO 4217 currency code (e.g., `EUR`) |
| `carrier` | TEXT | nullable | Shipping carrier (e.g., `DHL`, `USPS`) |
| `tracking_number` | TEXT | nullable | Carrier tracking number |
| `tracking_url` | TEXT | nullable | Direct link to carrier tracking page |
| `shipped_date` | DATE | nullable | Date item was shipped |
| `estimated_delivery_date` | DATE | nullable | Expected arrival date |
| `actual_delivery_date` | DATE | nullable | Date the item was actually received |
| `origin_description` | TEXT | nullable | Free-text origin description (e.g., gift from person) |
| `origin_place_id` | UUID | FK → `places.id`, SET NULL, nullable | Geographic origin of the shipment |
| `destination_location_id` | UUID | FK → `locations.id`, SET NULL, nullable | Target library location |
| `destination_sub_location_id` | UUID | FK → `sub_locations.id`, SET NULL, nullable | Target shelf/drawer within location |
| `notes` | TEXT | nullable | Personal collector notes |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `work` (N:1), `edition` (N:1), `instance` (N:1), `venue` (N:1), `originPlace` (N:1), `destinationLocation` (N:1), `destinationSubLocation` (N:1), `statusHistory` (1:N → `order_status_history`)

### `order_status_history`

Append-only audit log of every status transition for an order.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `order_id` | UUID | FK → `orders.id`, CASCADE, NOT NULL | Parent order |
| `from_status` | `order_status_enum` | nullable | Previous status (null for initial entry) |
| `to_status` | `order_status_enum` | NOT NULL | New status |
| `changed_at` | TIMESTAMPTZ | NOT NULL, auto | When the transition occurred |
| `notes` | TEXT | nullable | Optional note for this transition |

---

## Enums

### Postgres Enums (pgEnum)

These are native Postgres enum types enforced at the database level.

| pgEnum | Values |
|---|---|
| `catalogue_status_enum` | `tracked`, `shortlisted`, `wanted`, `on_order`, `accessioned`, `deaccessioned` |
| `acquisition_priority_enum` | `none`, `low`, `medium`, `high`, `urgent` |
| `instance_status_enum` | `available`, `lent_out`, `in_transit`, `in_storage`, `missing`, `damaged`, `deaccessioned` |
| `disposition_type_enum` | `sold`, `donated`, `gifted`, `traded`, `lost`, `stolen`, `destroyed`, `returned`, `expired` |
| `order_status_enum` | `placed`, `confirmed`, `processing`, `shipped`, `in_transit`, `out_for_delivery`, `delivered`, `purchased`, `received`, `bid`, `won`, `cancelled`, `returned` |
| `acquisition_method_enum` | `online_order`, `in_store_purchase`, `gift`, `digital_purchase`, `auction`, `event_purchase` |
| `venue_type_enum` | `bookshop`, `online_store`, `cafe`, `library`, `museum`, `gallery`, `auction_house`, `market`, `fair`, `publisher`, `individual`, `other` |
| `gender_enum` | `male`, `female` |

### Application-Level Enums

Defined as `const` arrays in `src/lib/types/index.ts` and enforced via Zod validation at the application layer.

| Enum | Values |
|---|---|
| `WORK_AUTHOR_ROLES` | `author`, `co_author` |
| `EDITION_CONTRIBUTOR_ROLES` | `translator`, `editor`, `illustrator`, `foreword`, `afterword`, `introduction`, `narrator`, `photographer`, `compiler`, `contributor` |
| `INSTANCE_FORMATS` | `hardcover`, `paperback`, `ebook`, `audiobook`, `pdf`, `epub`, `other` |
| `INSTANCE_CONDITIONS` | `mint`, `fine`, `very_good`, `good`, `fair`, `poor` |
| `ACQUISITION_TYPES` | `purchased`, `gift`, `inherited`, `borrowed`, `found`, `review_copy`, `other` |
| `BINDING_TYPES` | `hardcover`, `paperback`, `leather`, `cloth`, `boards`, `wrappers`, `spiral`, `saddle_stitch`, `other` |
| `LOCATION_TYPES` | `physical`, `digital` |
| `MEDIA_TYPES` | `poster`, `background`, `gallery` |

---

## Cascade Behavior

| Parent | Child | On Delete |
|---|---|---|
| `works` | `editions` | CASCADE |
| `works` | `work_status_history` | CASCADE |
| `editions` | `instances` | CASCADE |
| `instances` | `instance_status_history` | CASCADE |
| `locations` | `instances` | CASCADE |
| `sub_locations` | `instances.sub_location_id` | SET NULL |
| `works` | `work_authors` | CASCADE |
| `authors` | `work_authors` | CASCADE |
| `editions` | `edition_contributors` | CASCADE |
| `authors` | `edition_contributors` | CASCADE |
| `works` | `work_subjects` | CASCADE |
| `subjects` | `work_subjects` | CASCADE |
| `editions` | `edition_genres` | CASCADE |
| `genres` | `edition_genres` | CASCADE |
| `genres` | `genres.parent_id` | SET NULL |
| `editions` | `edition_tags` | CASCADE |
| `tags` | `edition_tags` | CASCADE |
| `collections` | `collection_editions` | CASCADE |
| `editions` | `collection_editions` | CASCADE |
| `works` | `media` | CASCADE |
| `authors` | `media` | CASCADE |
| `locations` | `sub_locations` | CASCADE |
| `works` | `work_categories` | CASCADE |
| `book_categories` | `work_categories` | CASCADE |
| `book_categories` | `book_categories.parent_id` | CASCADE |
| `works` | `work_literary_movements` | CASCADE |
| `literary_movements` | `work_literary_movements` | CASCADE |
| `literary_movements` | `literary_movements.parent_id` | CASCADE |
| `works` | `work_themes` | CASCADE |
| `themes` | `work_themes` | CASCADE |
| `themes` | `themes.parent_id` | CASCADE |
| `works` | `work_art_types` | CASCADE |
| `art_types` | `work_art_types` | CASCADE |
| `works` | `work_art_movements` | CASCADE |
| `art_movements` | `work_art_movements` | CASCADE |
| `works` | `work_keywords` | CASCADE |
| `keywords` | `work_keywords` | CASCADE |
| `works` | `work_attributes` | CASCADE |
| `attributes` | `work_attributes` | CASCADE |
| `works` | `work_recommenders` | CASCADE |
| `recommenders` | `work_recommenders` | CASCADE |
| `authors` | `author_contribution_types` | CASCADE |
| `contribution_types` | `author_contribution_types` | CASCADE |
| `publishing_houses` | `publishing_house_specialties` | CASCADE |
| `publisher_specialties` | `publishing_house_specialties` | CASCADE |
| `publishing_houses` | `publisher_isbn_prefixes` | CASCADE |
| `publishing_houses` | `publisher_auto_decisions` | SET NULL |
| `publishing_houses` | `publisher_hierarchy_changes` | CASCADE |
| `editions` | `edition_enrichments` | CASCADE |
| `countries` | `publishing_houses.country_id` | SET NULL |
| `series` | `works.series_id` | SET NULL |
| `work_types` | `works.work_type_id` | SET NULL |
| `works` | `orders` | CASCADE |
| `editions` | `orders.edition_id` | SET NULL |
| `instances` | `orders.instance_id` | SET NULL |
| `venues` | `orders.venue_id` | SET NULL |
| `places` | `orders.origin_place_id` | SET NULL |
| `locations` | `orders.destination_location_id` | SET NULL |
| `sub_locations` | `orders.destination_sub_location_id` | SET NULL |
| `orders` | `order_status_history` | CASCADE |

---

## Table Summary

| Category | Tables | Junction Tables |
|---|---|---|
| Core three-tier | `works`, `editions`, `instances` | — |
| Audit trail | `work_status_history`, `instance_status_history` | — |
| People | `authors` | `work_authors`, `edition_contributors`, `author_contribution_types` |
| Taxonomy (edition) | `genres`, `tags` | `edition_genres`, `edition_tags` |
| Taxonomy (work) | `subjects`, `book_categories`, `literary_movements`, `themes`, `art_types`, `art_movements`, `keywords`, `attributes` | `work_subjects`, `work_categories`, `work_literary_movements`, `work_themes`, `work_art_types`, `work_art_movements`, `work_keywords`, `work_attributes` |
| Recommenders | `recommenders` | `work_recommenders` |
| Reference | `languages`, `countries`, `centuries`, `work_types`, `contribution_types`, `sources`, `series` | — |
| Publishing | `publishing_houses`, `publisher_specialties`, `publisher_isbn_prefixes`, `ignored_publisher_names`, `publisher_auto_decisions`, `publisher_hierarchy_changes`, `edition_enrichments` | `publishing_house_specialties` |
| Location | `locations`, `sub_locations` | — |
| Organization | `collections` | `collection_editions` |
| Media | `media`, `gallery_layouts` | — |
| Import | `imports` | — |
| Provenance | `orders`, `order_status_history` | — |
| **Total** | **35 entity tables** | **17 junction tables** |

---

## Location Seed Data

Default locations seeded during ingestion:

| Name | Type | Icon | Color |
|---|---|---|---|
| Mexico City | physical | `map-pin` | `#c0a36e` |
| Amsterdam | physical | `map-pin` | `#648493` |
| Calibre | digital | `book-open` | `#76946a` |
| Kindle | digital | `tablet` | `#586e75` |
| Audiobook | digital | `headphones` | `#7d3d52` |

---

## Example Queries

**"Show me all books I own in Mexico"**:
```sql
SELECT DISTINCT w.*, e.*
FROM works w
JOIN editions e ON e.work_id = w.id
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE l.name = 'Mexico City'
  AND w.catalogue_status = 'catalogued';
```

**"Show me all editions of Don Quixote I own"**:
```sql
SELECT e.*, l.name AS location
FROM editions e
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE e.work_id = '{don_quixote_work_id}';
```

**"Show me all books translated by Gregory Rabassa"**:
```sql
SELECT DISTINCT w.title AS work_title, e.title AS edition_title, e.language
FROM edition_contributors ec
JOIN authors a ON a.id = ec.author_id
JOIN editions e ON e.id = ec.edition_id
JOIN works w ON w.id = e.work_id
WHERE a.name = 'Gregory Rabassa'
  AND ec.role = 'translator';
```

**"Which books do I own physically but not digitally?"**:
```sql
SELECT DISTINCT w.*, e.*
FROM works w
JOIN editions e ON e.work_id = w.id
JOIN instances i ON i.edition_id = e.id
JOIN locations l ON l.id = i.location_id
WHERE l.type = 'physical'
  AND w.id NOT IN (
    SELECT DISTINCT w2.id
    FROM works w2
    JOIN editions e2 ON e2.work_id = w2.id
    JOIN instances i2 ON i2.edition_id = e2.id
    JOIN locations l2 ON l2.id = i2.location_id
    WHERE l2.type = 'digital'
  );
```

**"What books are currently lent out?"**:
```sql
SELECT w.title, e.title AS edition, i.lent_to, i.lent_date, l.name AS from_location
FROM instances i
JOIN editions e ON e.id = i.edition_id
JOIN works w ON w.id = e.work_id
JOIN locations l ON l.id = i.location_id
WHERE i.is_lent_out = true;
```

---

## Venues Table

### `venues`

Real-world and online establishments where books are acquired, browsed, or experienced. This is the "Places" section of the catalogue.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `name` | TEXT | NOT NULL | Venue name |
| `slug` | TEXT | UNIQUE, nullable | URL slug (auto-generated from name) |
| `type` | `venue_type_enum` | NOT NULL | Category: `bookshop`, `online_store`, `cafe`, `library`, `museum`, `gallery`, `auction_house`, `market`, `fair`, `publisher`, `individual`, `other` |
| `subtype` | TEXT | nullable | More specific classification (e.g. "second-hand", "academic") |
| `description` | TEXT | nullable | Description of the venue |
| `website` | TEXT | nullable | Website URL |
| `instagram_handle` | TEXT | nullable | Instagram handle |
| `social_links` | JSONB | nullable | Additional social links `{ twitter, facebook, ... }` |
| `place_id` | UUID | FK → `places.id`, nullable, SET NULL | Geographic place reference |
| `formatted_address` | TEXT | nullable | Full street address |
| `google_place_id` | TEXT | nullable | Google Places API identifier |
| `phone` | TEXT | nullable | Phone number |
| `email` | TEXT | nullable | Contact email |
| `opening_hours` | JSONB | nullable | Structured opening hours |
| `timezone` | TEXT | nullable | IANA timezone identifier |
| `poster_s3_key` | TEXT | nullable | S3 key for venue poster image |
| `thumbnail_s3_key` | TEXT | nullable | S3 key for thumbnail image |
| `color` | TEXT | nullable | Brand/accent color for display |
| `is_favorite` | BOOLEAN | NOT NULL, default `false` | Marked as favorite |
| `personal_rating` | SMALLINT | nullable | Personal rating 1–5 |
| `notes` | TEXT | nullable | Personal notes |
| `specialties` | TEXT | nullable | What the venue specialises in |
| `tags` | TEXT[] | nullable | Free-form tags |
| `first_visit_date` | DATE | nullable | Date of first visit |
| `last_visit_date` | DATE | nullable | Date of most recent visit |
| `total_orders` | INTEGER | NOT NULL, default `0` | Denormalised order count |
| `total_spent` | NUMERIC(12,2) | NOT NULL, default `0` | Denormalised total spend |
| `last_order_date` | DATE | nullable | Date of most recent order |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `place` (N:1 → `places`, optional)

**Enum `venue_type_enum`**: `bookshop`, `online_store`, `cafe`, `library`, `museum`, `gallery`, `auction_house`, `market`, `fair`, `publisher`, `individual`, `other`

---

## Calibre Integration (Reader)

### `calibre_books`

Mirrors metadata from the Calibre ebook library for in-app reading. Not all entries link to a Durtal work; the Reader tab can browse the full Calibre catalogue independently.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, auto | |
| `calibre_id` | INTEGER | NOT NULL, UNIQUE | Primary key from Calibre's `books.id` |
| `calibre_uuid` | TEXT | nullable | Calibre's internal UUID |
| `title` | TEXT | NOT NULL | Book title from Calibre |
| `author_sort` | TEXT | nullable | "Last, First" author sort from Calibre |
| `path` | TEXT | NOT NULL | Relative path within Calibre library (e.g. `Author/Title (id)`) |
| `has_cover` | BOOLEAN | NOT NULL, default `false` | Whether `cover.jpg` exists in Calibre |
| `cover_s3_key` | TEXT | nullable | S3 key for the cover image (e.g. `gold/calibre/{id}/cover.jpg`) |
| `isbn` | TEXT | nullable | First ISBN found in Calibre identifiers |
| `formats` | JSONB | nullable | Array of `{ format, fileName, sizeBytes, s3Key }` |
| `pubdate` | TEXT | nullable | Publication date from Calibre |
| `work_id` | UUID | FK -> `works.id`, nullable, SET NULL | Link to Durtal catalogue (via ISBN match or manual linking) |
| `last_synced` | TIMESTAMPTZ | NOT NULL, auto | When this record was last synced from Calibre |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `work` (N:1 -> `works`, optional)

**File path resolution**: `{CALIBRE_LIBRARY_PATH}/{path}/{formats[n].fileName}.{formats[n].format}`

### `reading_progress`

Tracks reading position, bookmarks, and per-book reader settings. One record per Calibre book.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, auto | |
| `calibre_book_id` | UUID | NOT NULL, UNIQUE, FK -> `calibre_books.id` CASCADE | |
| `current_cfi` | TEXT | nullable | EPUB CFI string for current position |
| `current_page` | INTEGER | nullable | PDF page number |
| `progress_percent` | REAL | nullable | 0.0 to 1.0 |
| `current_chapter` | TEXT | nullable | Human-readable chapter name |
| `total_reading_seconds` | INTEGER | default `0` | Cumulative reading time |
| `started_at` | TIMESTAMPTZ | NOT NULL, auto | When reading began |
| `last_read_at` | TIMESTAMPTZ | NOT NULL, auto | Most recent reading session |
| `finished_at` | TIMESTAMPTZ | nullable | When the book was completed |
| `bookmarks` | JSONB | nullable | Array of `{ cfi, label?, contextText?, createdAt }` |
| `reader_settings` | JSONB | nullable | Per-book overrides: `{ fontSize, fontFamily, lineHeight, margin, textAlign }` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `calibreBook` (N:1 -> `calibre_books`)

## Activity & Comments

### `activity_events`

Audit log tracking every mutation to Works and Authors. Polymorphic via `entity_type` + `entity_id`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, auto | |
| `entity_type` | TEXT | NOT NULL | `"work"` or `"author"` |
| `entity_id` | UUID | NOT NULL | References `works.id` or `authors.id` (no FK) |
| `event_key` | TEXT | NOT NULL | e.g. `"work.title_changed"`, `"author.poster_uploaded"` |
| `metadata` | JSONB | nullable | Structured: `{ oldValue, newValue, targetName, targetId, taxonomyType, editionIsbn, locationName, collectionName, commentId, extra }` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Indexes**: composite on `(entity_type, entity_id)`, single on `created_at`

### `comments`

Rich-text comments attached to Works or Authors. Content stored as both rendered HTML and Tiptap JSON for re-editing.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, auto | |
| `entity_type` | TEXT | NOT NULL | `"work"` or `"author"` |
| `entity_id` | UUID | NOT NULL | References `works.id` or `authors.id` (no FK) |
| `content_html` | TEXT | NOT NULL | Server-sanitized HTML for display |
| `content_json` | JSONB | nullable | Tiptap JSON document for re-editing |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Indexes**: composite on `(entity_type, entity_id)`, single on `created_at`
**Relations**: `attachments` (1:N -> `comment_attachments`)

### `comment_attachments`

File attachments on comments, stored in S3.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, auto | |
| `comment_id` | UUID | NOT NULL, FK -> `comments.id` CASCADE | |
| `file_name` | TEXT | NOT NULL | Original filename |
| `file_size` | INTEGER | NOT NULL | Size in bytes |
| `mime_type` | TEXT | NOT NULL | e.g. `"image/png"`, `"application/pdf"` |
| `s3_key` | TEXT | NOT NULL | Full S3 object key |
| `is_image` | BOOLEAN | NOT NULL, default `false` | For inline thumbnail rendering |
| `thumbnail_url` | TEXT | nullable | Pre-signed or public URL for image previews |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `comment` (N:1 -> `comments`)

## Harmonization

`/harmonize` derives its findings from current catalogue records using a capability registry; findings are not copied into a second catalogue. Migration `0032_harmonization` adds three persistence tables:

| Table | Columns | Purpose |
|---|---|---|
| `harmonization_decisions` | `finding_key TEXT PK`, `fingerprint TEXT NOT NULL`, `reason TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` | Persistent dismissals. A changed evidence fingerprint resurfaces the finding. |
| `harmonization_operations` | `id UUID PK DEFAULT gen_random_uuid()`, `action TEXT`, `entity TEXT`, `source_id UUID`, `target_id UUID NULL`, `label TEXT`, `before JSONB`, `after JSONB NULL`, `created_at TIMESTAMPTZ DEFAULT now()` | Atomic resolution audit. All fields except `target_id` and `after` are required; completed operations include the resulting snapshot. Indexed on `created_at`. IDs deliberately have no FK so history survives deletion. |
| `harmonization_redirects` | `source_id UUID PK`, `entity TEXT NOT NULL`, `source_slug TEXT NULL`, `target_id UUID NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` | Old IDs/slugs follow surviving records. Indexed on `(entity, source_slug)`. Repeated merges flatten redirect chains. |

Merges discover inbound foreign keys from the Drizzle schema and explicitly include polymorphic comments, activity and gallery layouts. Composite-key membership links are unioned; editions, copies, acquisitions, media, annotations and other linked records are transferred. Derived gallery layouts are invalidated. All affected rows are retained in the original audit snapshot. Any previously unknown database foreign key blocks the merge pending an explicit strategy. Existing active collecting targets with colliding identities block a merge, preserving orders and fulfilment provenance.

The transaction takes ordered table locks, verifies the preview fingerprint, records its audit, transfers references, removes the source, reconciles survivor fields, validates acquisition compatibility and saves the resulting snapshot. `harmonization_allows_move` recognizes only the exact audited identity move in the current transaction. Existing edition, target, publisher and order guard functions retain their checks outside that path, including cancelled acquisition history. Lock and statement timeouts bound contention. Merges have no automatic undo; before/after records can be inspected and downloaded.

Work merges preserve the **Work → Edition → Instance** separation. Edition/copy/order duplicates require individual review; the generic merger never collapses distinct printings, ownership or provenance into a work.
