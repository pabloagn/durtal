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
| `slug` | TEXT | UNIQUE, nullable | Human-readable URL slug (format: `{title}-by-{author}`) |
| `original_language` | TEXT | NOT NULL, default `'en'` | ISO 639-1 code |
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
| `publisher` | TEXT | nullable | Publisher name |
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
| `language` | TEXT | NOT NULL, default `'en'` | ISO 639-1 code |
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
| `death_year` | SMALLINT | nullable | |
| `death_month` | SMALLINT | nullable | |
| `death_day` | SMALLINT | nullable | |
| `death_year_is_approximate` | BOOLEAN | default `false` | |
| `death_year_gregorian` | SMALLINT | nullable | Gregorian calendar year |
| `nationality_id` | UUID | FK → `countries.id`, SET NULL | |
| `bio` | VARCHAR(10000) | nullable | |
| `photo_s3_key` | TEXT | nullable | S3 key for author photo |
| `website` | TEXT | nullable | |
| `open_library_key` | TEXT | nullable | |
| `goodreads_id` | TEXT | nullable | |
| `metadata_source` | TEXT | nullable | |
| `metadata_source_id` | TEXT | nullable | |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `workAuthors` (N:M via junction), `editionContributors` (N:M), `media` (1:N), `authorContributionTypes` (N:M)

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
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Indexed on: `name`, `alpha_2`, `alpha_3`, `continent_name`. Seeded from Knowledge_Base (262 rows).

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

Publisher entities with country association.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | UNIQUE, NOT NULL |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `country` | TEXT | nullable |
| `country_id` | UUID | FK → `countries.id`, nullable |
| `description` | TEXT | nullable |
| `website` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Seeded from Knowledge_Base (172 rows).

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

User-curated groups of editions.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | nullable |
| `cover_s3_key` | TEXT | nullable |
| `sort_order` | INTEGER | NOT NULL, default `0` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto |

---

## Media & Import Tables

### `media`

Images attached to works or authors. Polymorphic ownership.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `work_id` | UUID | FK → `works.id`, CASCADE, nullable |
| `author_id` | UUID | FK → `authors.id`, CASCADE, nullable |
| `type` | TEXT | NOT NULL (`'poster'`, `'background'`, `'gallery'`) |
| `s3_key` | TEXT | NOT NULL |
| `thumbnail_s3_key` | TEXT | nullable |
| `original_filename` | TEXT | nullable |
| `mime_type` | TEXT | nullable |
| `width` | INTEGER | nullable |
| `height` | INTEGER | nullable |
| `size_bytes` | INTEGER | nullable |
| `is_active` | BOOLEAN | NOT NULL, default `true`. For poster/background: only one active per owner+type. For gallery: always true. |
| `crop_x` | REAL | NOT NULL, default `50`. Horizontal focal-point percentage (0-100) for CSS `object-position`. |
| `crop_y` | REAL | NOT NULL, default `50`. Vertical focal-point percentage (0-100) for CSS `object-position`. |
| `crop_zoom` | REAL | NOT NULL, default `100`. Zoom percentage (100 = no zoom, up to 300). Applied as CSS `transform: scale()`. |
| `original_s3_key` | TEXT | nullable. S3 key for the pre-processing color original. Set only for author media with monochrome processing. |
| `processing_params` | JSONB | nullable. Monochrome processing parameters: `{ grayscale: true, contrast: number, sharpness: number, gamma: number, brightness: number }`. Author media only. |
| `sort_order` | SMALLINT | NOT NULL, default `0` |
| `caption` | TEXT | nullable |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

**Check constraint**: `(work_id IS NOT NULL) != (author_id IS NOT NULL)` — exactly one owner.

**Active selection**: Multiple posters/backgrounds can exist for a work, but only one is active at a time. Uploading a new poster deactivates the previous one (without deleting it). Users can switch the active poster/background or permanently delete unwanted items.

**Crop positioning**: The `crop_x`, `crop_y`, and `crop_zoom` fields store CSS-only positioning metadata. They control how an image is displayed within its container via `object-position` and `transform: scale()`, without modifying the original S3 files. Users adjust these values through a drag-and-zoom editor in the media manager.

**Author monochrome processing**: Author images are automatically processed through a grayscale + normalization pipeline. The original color image is stored in `original_s3_key`, and the processed monochrome variant is stored in `s3_key`. Processing parameters are configurable per media item via `processing_params`, allowing per-image tuning of contrast, sharpness, gamma, and brightness. Re-processing fetches the original and applies new parameters without quality loss.

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

## Enums

### Postgres Enums (pgEnum)

These are native Postgres enum types enforced at the database level.

| pgEnum | Values |
|---|---|
| `catalogue_status_enum` | `tracked`, `shortlisted`, `wanted`, `on_order`, `accessioned`, `deaccessioned` |
| `acquisition_priority_enum` | `none`, `low`, `medium`, `high`, `urgent` |
| `instance_status_enum` | `available`, `lent_out`, `in_transit`, `in_storage`, `missing`, `damaged`, `deaccessioned` |
| `disposition_type_enum` | `sold`, `donated`, `gifted`, `traded`, `lost`, `stolen`, `destroyed`, `returned`, `expired` |

### Application-Level Enums

Defined as `const` arrays in `src/lib/types/index.ts` and enforced via Zod validation at the application layer.

| Enum | Values |
|---|---|
| `WORK_AUTHOR_ROLES` | `author`, `co_author` |
| `EDITION_CONTRIBUTOR_ROLES` | `translator`, `editor`, `illustrator`, `foreword`, `afterword`, `introduction`, `narrator`, `photographer`, `compiler` |
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
| `countries` | `publishing_houses.country_id` | SET NULL |
| `series` | `works.series_id` | SET NULL |
| `work_types` | `works.work_type_id` | SET NULL |

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
| Publishing | `publishing_houses`, `publisher_specialties` | `publishing_house_specialties` |
| Location | `locations`, `sub_locations` | — |
| Organization | `collections` | `collection_editions` |
| Media | `media` | — |
| Import | `imports` | — |
| **Total** | **32 entity tables** | **17 junction tables** |

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
