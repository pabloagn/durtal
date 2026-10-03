# Data Model

Durtal's book catalogue uses a three-tier data model drawn from FRBR (Functional Requirements for Bibliographic Records). The separation between intellectual creation, physical publication, and individual copy is fundamental to books. The curated-library expansion preserves that model and introduces explicit work kinds; see [the architecture and delivery plan](14_CURATED_LIBRARY_PLAN.md).

## Work domains (foundation)

Migration `0037_work_kinds` adds `works.kind` using `work_kind_enum`:
`book`, `film`, `perfume`, `painting`. Existing rows and inserts that omit the
column default to `book`. This identity is independent of `work_type_id` and all
taxonomies: a book about painting remains a book.

Only books are currently enabled. The `works_kind_enabled_check` constraint
rejects all non-book writes until their models and legacy-query isolation pass
the rollout gates. `src/lib/catalogue/domains.ts` records the same application
readiness plus domain labels, routes, primary creator vocabulary and image
presentation defaults. Unready domains must not be advertised in navigation.

Kind is immutable. The `works_kind_immutable` trigger rejects a changed kind,
even after a future activation migration widens the enabled-kind check.
Book create and fast-track inputs accept only `book`; the update schema and
action reject an explicit kind. Domain pages remain gated while shared data
tables are introduced. No current IDs, slugs, edition/copy relations or media keys are rewritten.

Migration `0038_book_boundaries` preserves that separation after future domain
activation. The `book_parent_required` triggers reject non-book parents on
insert and reparenting of `editions`, `work_authors`, `acquisition_targets`,
`orders`, `calibre_books`, and `work_status_history`. Calibre links may remain
null. Existing foreign keys retain their deletion behavior; immutable work
kind keeps the validated relationship valid for its lifetime. These triggers
are maintained as custom SQL in the Drizzle migration and validated on populated
data, since Drizzle snapshots do not represent triggers.

The `works_book_series_check` constraint reserves the legacy series fields
for books. Shared media, recommendation and work-taxonomy links remain capable
of referencing any kind. Book adapters filter those links and root work queries
before counting or pagination, and reject non-book mutation targets before
changing related records. Slug uniqueness remains global. Book harmonization
scans exclude other kinds, and executable book merges require two books.

---

## Perfume domain model

Migration `0044_perfume_model` adds a fragrance profile, formulations and personal
containers. The domain remains disabled pending its services, UI and release gates.

| Table | Key and relationships | Purpose |
| --- | --- | --- |
| `perfume_details` | Work UUID PK/FK; release/discontinuation date values and source | A profile may belong only to a perfume work |
| `perfume_variants` | UUID; fragrance FK; concentration/label, formulation label; dates/source; perfumer override | Unknown concentration/formulation remain null; null-aware identity uniqueness prevents exact duplicate variants |
| `perfume_organizations` | `(work_id, organization_id, role)`; ordered, optionally sourced | Explicit house, brand and manufacturer links require matching organization roles |
| `perfume_notes` | `(work_id, item_id, position)`; order/source | Top, heart, base and unspecified notes use the perfume-note vocabulary |
| `perfume_variant_overrides` | `(variant_id, family_id)` | Declares replacement for one applicable taxonomy family, even when intentionally empty |
| `perfume_variant_taxa` | `(variant_id, item_id)`; source | Variant family/accord/custom classification under an explicit override |
| `perfume_variant_notes` | `(variant_id, item_id, position)`; order/source | Positioned notes under the variant's perfume-note override |
| `perfume_variant_perfumers` | UUID; variant/person FKs; credited-as, attribution, order, notes/source | Formulation-specific perfumers may replace inherited work perfumers; unknown/anonymous credits need no dummy person |
| `perfume_bottles` | UUID; variant FK; container kind, quantities, status, location, acquisition and disposition | Personal bottle, sample or decant; size never creates a new work or formulation |

Variant perfumers inherit the fragrance's ordered `perfume.perfumer` work credits
unless `perfumers_override` is true. An explicit empty override means no attributed
perfumer for that formulation. Variant credits retain stable UUIDs and credited-as
text through person merges and protect people from deletion. Linking a person
registers their perfume domain. Generic creative-director and other work credits
remain in the shared credit model.

Taxonomy inheritance is independently controlled per family: absent override means
inherit; present override means use only variant assignments, including none.
Notes are stored only in the positioned note tables, never a competing generic
work/variant assignment. Family, domain and level checks protect every assignment.
Used applicability scopes, vocabularies and nonempty overrides cannot be removed.
Read helpers resolve effective classification and perfumers without per-item queries.

Every source FK must reference an observation owned by the same perfume work.
Release/discontinuation and acquisition/disposition dates reject definitely reversed
intervals while preserving partial precision. Date value objects become immutable;
editing a typed date creates and references a replacement, so another record cannot
silently acquire changed dates. Profile/formulation work identity cannot be changed
through ordinary updates.

The perfume services (`src/lib/actions/perfumes.ts`, SLN-357) own each date value
they create. In the same transaction as an edit or deletion, they remove a replaced
value once no column in `CATALOGUE_DATE_REFERENCES` (`src/lib/catalogue/dates.ts`)
still points at it. An integration test keeps that list equal to the database's
foreign keys to `catalogue_dates`; a new referencing column must be added there.

Containers retain capacity value/unit (ml or l), generated capacity ml, optional
remaining ml, batch, condition, notes and personal holding status. Values support
0.001 ml precision, including fractional-liter samples; unknown remaining quantity
stays null. Capacity is positive and remaining amount is bounded by it. An empty
retained bottle and a disposed bottle are distinct. Typed database projections feed
the shared holdings contract; no edition or book instance is involved.

Optional storage references a physical personal location and a matching sublocation;
neither is fabricated when unknown. Acquisition references a date value, retailer
organization, venue, and paired nonnegative price/currency. Disposition has its own
date and reason. Referenced supplier roles, venues and locations are protected;
location edits cannot turn a perfume shelf into digital storage. A variant or work
with containers cannot be deleted implicitly. Typed order links remain SLN-374.

The shared `works.original_language` column is now nullable, with a domain check:
books retain their non-null language and legacy English insert default, while
non-books must explicitly store null. Domain language information belongs in typed
profiles, not a fabricated book language. Existing book detail APIs validate and
narrow this invariant, preserving their return contracts and UI callers.

### Perfume retailer listings and dated observations

Migration `0045_venues_retailer_observations` records where a fragrance is sold.
Price and stock are dated observations, never permanent facts. There are no live
commerce actions and no scraping.

| Table | Key and relationships | Purpose |
| --- | --- | --- |
| `perfume_retailer_links` | UUID; fragrance FK (`perfume_details`), optional formulation FK, retailer organization FK, optional branch venue FK, HTTP(S) URL, optional source; `archived_at` | One listing. Null-aware uniqueness on fragrance, formulation, retailer, branch and URL |
| `perfume_retailer_observations` | UUID; listing FK; `checked_at`, availability, paired price/currency, optional container kind, offered capacity ml, package label, source, notes; `recorded_at` | Append-only history. Update and delete are rejected |

All foreign keys are RESTRICT. The trigger `perfume_retailer_link_guard` requires:

- a formulation that belongs to the same fragrance;
- an organization with the `retailer` role, which cannot then be removed from it;
- for a branch, an `operator` link in `organization_venues`, and a branch that is not archived;
- a source observation owned by the same fragrance.

Listing identity (fragrance, formulation, URL, source) is immutable: archive the
listing and create a replacement. The retailer or branch changes only through an
audited organization or venue merge. An archived listing or branch accepts no new
observations until restored.

Availability is `unknown`, `in_stock`, `out_of_stock`, `preorder`,
`discontinued` or `unlisted`. Price needs an ISO currency code. Offered capacity
needs a container kind. `checked_at` cannot be later than the time of recording
plus five minutes. The latest observation orders by `checked_at`, not insertion
order; a lateral join returns it with each listing in one query. Staleness is a
read-time hint (default 30 days); an old observation stays visibly dated.

## Film domain model

Migration `0046_film_model` adds a film profile, versions (cuts), releases and
optional personal copies. The domain stays disabled until its screens and
release gates pass (`works_kind_enabled_check` still allows only books).

| Table | Key and relationships | Purpose |
| --- | --- | --- |
| `film_details` | Work UUID PK/FK; original title; release date value; source | A profile may belong only to a film work |
| `film_countries` | `(work_id, country_id)`; order | Production countries in credited order |
| `film_languages` | `(work_id, language_id)`; order | Original spoken languages in credited order |
| `film_organizations` | `(work_id, organization_id, role)`; order, source | Production companies; the organization needs the `production_company` role |
| `film_versions` | UUID; film FK; label, runtime seconds, order, notes, source | A cut or version; null-aware unique label per film; unknown runtime stays null |
| `film_releases` | UUID; version FK; country (null = worldwide or unspecified), territory label, format, release date value, distributor, notes, source | One public release; a distributor needs the `distribution_company` role |
| `film_holdings` | UUID; film FK; optional version and release; medium, format label, status, condition, location, acquisition and disposition | An optional personal copy (disc, print, file) |

Cast and crew are ordered `work_credits` with `film.*` roles: several directors
or writers, one performer with several characters, credited-as names and unknown
performers need no dummy person. A remake is a separate film work; a director's
cut is a version of the same film. Release formats are `theatrical`,
`festival`, `television`, `home_media`, `streaming` and `other`.

Rules (triggers): a profile needs a film work; profile, company and version rows
cannot move to another film, and a release cannot move to another version. A
copy's version and release must belong to its film, and a release to the named
version. A physical copy needs a physical location and a digital copy a digital
one; location type and sublocation changes that would break this are rejected.
A copy's supplier needs the `retailer` role. Company, distributor and supplier
roles in use cannot be removed (deferred constraint trigger on
`organization_roles`). Every source must be owned by the same film.

Copies are the only personal holdings: curation, ratings and viewing never
create one. A copy protects its film, version and release from deletion
(RESTRICT). Deleting a film cascades its versions, releases and origins.

## Painting domain model

Migration `0047_painting_model` adds a painting profile and identifiable art
objects. A curated painting needs no object, edition or owned copy. The domain
stays disabled until its screens and release gates pass.

| Table | Key and relationships | Purpose |
| --- | --- | --- |
| `painting_details` | Work UUID PK/FK; creation date value; source | A profile may belong only to a painting work |
| `art_objects` | UUID; painting FK; kind, label, reproduced object, creation date, dimensions and unit, attribution override, ownership, owner organization or label, collection, accession number, personal holding fields, notes, source | One physical object: an original, an identified version or a reproduction |
| `art_object_credits` | UUID; object FK; person, credited-as, attribution, order, notes, source | Object attribution ("workshop of", "attributed to") that replaces the painting's painters when declared |
| `art_object_taxa` | `(object_id, item_id)`; source | Object technique, medium and support |

Painters are ordered `work_credits` with the `painting.painter` role; unknown
painters need no dummy person. Genres, techniques, media and supports use the
`painting-*` vocabularies; art movements reuse `work_art_movements`. An object's
taxa replace the painting's values family by family; families without object
values are inherited. Object attribution replaces the painters only while
`attribution_override` is true, and credits must be removed before it is reset.

Several originals or versions of one painting need distinct labels (unique
index on work and label, reproductions excluded). A reproduction may name the
original or version it reproduces, which must belong to the same painting; that
object cannot be deleted or turned into a reproduction while it is referenced.
Dimensions are optional; a unit (`mm`, `cm`, `in`) is required exactly when a
dimension is given, and generated `height_cm` and `width_cm` give native
proportions.

Ownership is `institutional` (names an organization; optional collection and
accession number), `private` (optional owner label), `personal` (the collector;
holding status, physical personal location, acquisition and disposition) or
`unknown`. Accession numbers are unique per owning organization, ignoring case
and surrounding spaces. Physical whereabouts are a separate dated record
(SLN-360); ownership never implies where an object hangs or that it is shown.

### `art_object_whereabouts`

Migration `0048_art_whereabouts` records where each art object physically is or
was, as dated, sourced statements.

| Column | Meaning |
| --- | --- |
| `object_id` | The art object (CASCADE: the history goes with a deleted object; the object cannot change) |
| `place_kind` | `venue`, `private`, `unknown`, `lost` or `destroyed` |
| `venue_id` | Required exactly for `venue` (RESTRICT) |
| `place_label` | Wording a venue cannot express, such as "Private collection, Geneva" |
| `custody` | `permanent_collection`, `temporary_loan`, `long_term_loan`, `private` or `unknown`; collections and loans need a venue; lost and destroyed need `unknown` |
| `display_status` | `on_display`, `in_storage` or `unknown` (default); stated only at a venue, never inferred from ownership |
| `certainty` | `confirmed`, `probable` or `uncertain` |
| `starts_on_id`, `ends_on_id` | Date values; a null start is unknown, a null end is current |
| `occasion_label` | An exhibition or occasion, such as a loan exhibition title |
| `recorded_at`, `verified_at` | When the statement was entered and last checked; verification cannot be in the future |
| `source_record_id` | A source owned by the same painting |

Rules: confirmed records of one object form a single history. A partial unique
index allows one current confirmed record, and the trigger rejects confirmed
periods that definitely overlap; periods that only touch or share a partial
boundary (1911 and 1911) stay valid. Probable and uncertain claims may overlap
anything. Each write locks the object row, so two competing moves cannot both
pass. A venue in any location record cannot be deleted; archive it instead.
Venue merges move the records.

`recordWhereabouts` treats a confirmed, open-ended record as a move: it closes
the current confirmed record on the move date and opens the new one in one
transaction, guarded by a fingerprint of the object's whole history.
Corrections may be backdated. Reads return the current record, the history,
conflicting claims (probable or uncertain records that may overlap the current
period at another place) and staleness (current location unchecked for 365
days by default).

## Personal curation and holdings contracts

## Personal curation and holdings contracts

Migration `0043_shared_curation` adds `works.is_favourite BOOLEAN NOT NULL DEFAULT
false`. Shared notes/rating and `work_recommenders` keep their existing canonical
storage. Being in the catalogue expresses personal curation; it never implies
ownership, acquisition intent, reading or viewing. There is no duplicated curation
record or generic ownership flag.

`getWorkCuration` returns a snapshot fingerprint over only the personal fields and
recommendations. `updateWorkCuration` accepts sparse, strictly validated personal
edits, locks the work, checks that fingerprint and atomically updates all requested
fields/links. Stale editors and missing recommendation targets leave the previous
curation intact. These edits never change book statuses or create copies.

`works_nonbook_lifecycle_check` reserves legacy `catalogue_status`,
`acquisition_priority`, `is_rare` and `hunt_assessed_on` for books. Non-books retain
the neutral compatibility defaults (`tracked`, `none`, false, null) until the
typed acquisition model is added. The exhaustive domain capability matrix declares
which controls each kind supports; availability also checks rollout readiness.
Book mutation guards use the shared book-lifecycle capability.

`catalogue/holdings.ts` provides typed domain projections. Books reuse the existing
ownership and derived-status functions, including partial holdings and inconsistent
deaccession states. Non-book personal holdings distinguish held, lent out, stored,
missing and disposed objects; disposition excludes current ownership. Perfume
summaries distinguish bottles/samples/decants, known remaining ml and unknown
quantities; an empty retained bottle is still a container but contributes zero
liquid. Film copies distinguish physical/digital holdings; a viewing is not a copy.
Painting summaries count only explicitly personal originals, versions and
reproductions. Institutional/private/unknown ownership never becomes personal
ownership through a museum location; a personal object on loan remains owned.
Duplicate projected object IDs are rejected instead of inflating counts.

These pure projections define the contract consumed by the domain models. Their
database queries and persistent non-book holdings arrive with SLN-356/358/359;
there are no placeholder editions or generic untyped holding rows.

## Typed identifiers, source observations and uncertain dates

Migration `0042_catalogue_provenance` adds these shared value structures. It does
not rewrite historic book/person provider strings, source IDs or edition locks.

| Table | Identity and fields | Integrity |
| --- | --- | --- |
| `catalogue_identifiers` | UUID; provider, entity kind, external ID; created timestamp; one explicit work/edition/person/organization/venue FK | Unique `(provider, entity_kind, external_id)`; exactly one owner; work kind must match; namespace is immutable |
| `source_records` | UUID; same typed owner; optional identifier; provider, HTTP(S) URL, attribution; retrieval and verification timestamps; JSON source payload and SHA-256; review status, manual lock, revision; optional previous observation | Immutable observation payload and identity; one successor per observation; same owner/provider/URL/identifier across history; verification cannot precede retrieval |
| `catalogue_dates` | UUID; precision; nullable start/end civil year, month and day; approximate flag; original display label; generated lower/upper ordering bounds | Valid components, precision and range order; no year zero; index on bounds |

Identifiers are idempotently registered for their existing owner. Claiming the
same provider/kind/ID for another record is an explicit conflict, even if the
titles match. Different providers or entity kinds may reuse the same external
ID. Owner foreign keys cascade only when their catalogue record is deleted,
except venues: migration 0045 makes the venue owner FK RESTRICT, so a venue with
identifiers or source observations must be archived, not deleted.
Reparenting requires the exact audited harmonization move; deferred checks retain
identifier/source consistency when a merge transfers them in separate statements.
Merges preserve source UUIDs, payloads, locks and history in the survivor and audit.

Source JSON is a provider observation, never the canonical domain metadata store.
`recordSourceObservation` records it; `refreshSourceObservation` appends a pending
successor and leaves the previous observation intact. A refresh locks and checks
the predecessor, rejects older retrievals, manual locks and stale revisions, and
allows one competing refresh to succeed. Review edits use a revision check too.
The pure `proposeSourcedChanges` helper proposes only missing values, preserves
nonempty curated values, and reports differing or locked fields for review.
Provider-specific matching and promotion remain SLN-375–378; accepting an
observation alone does not overwrite a work.

`getCatalogueProvenance` exposes both the new records and an unchanged legacy
view of work/person `metadata_source`/`metadata_source_id` and edition
`metadata_source`/`metadata_last_fetched`/`metadata_locked`. Ambiguous historic
provider strings are not silently assigned a new namespace. New source links
reject credentials and non-HTTP protocols. Source snapshots are limited to 1 MB
through the action contract. Owner/date and identifier indexes support retrieval;
observation history uses bounded, deterministic pagination.

Date precision is `unknown`, `year`, `month`, `day` or `range`, independently of
`approximate` and the original label. Typed future domain columns reference these
values; there is no generic field-key table. A year remains year-only in storage.
The bounds are numeric ordering keys (`civil_year * 10000 + month * 100 + day`),
not dates to display as if known: 1905 has bounds 19050101–19051231 and null month
and day. Unknown dates have null bounds. A range may use partial endpoints; it is
valid when the earliest possible start does not exceed the latest possible end.
Components use proleptic Gregorian rules, civil BCE numbering and years from
-999999 through 999999, excluding zero. Historical labels remain available when
a source uses a different calendar or less precise wording. Invalid legacy years
require review rather than silent coercion. Existing book year columns remain.

Shared measurement validation keeps dimensions (mm/cm/m/in), perfume volumes
(ml/l), and film durations (s/min/h) distinct, normalizing to mm, ml and seconds.
It rejects nonfinite/nonpositive values, foreign units and ambiguous fluid ounces.
Domain models retain the specific measurement meaning and original unit as needed.

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
| `kind` | `work_kind_enum` | NOT NULL, default `book`; immutable; currently book-only CHECK | Stable domain identity, independent of work-type taxonomy |
| `slug` | TEXT | UNIQUE, nullable | Human-readable URL slug. Books: `{title}-by-{author}`, with `-2`, `-3`... when taken; it follows the title and primary author, so a work rename, a new primary author, an author rename or an author merge refreshes it (`src/lib/works/slug.ts`, books only). Other domains: `{title}-{uuid}`, unchanged by renames. Old slugs do not redirect |
| `original_language` | TEXT | nullable, default `'en'`; required for books and null for other domains (`works_language_domain_check`) | Language code; stored form set by trigger (see `languages`). An absent value stays absent |
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

Canonical person identities across books, films, perfumes and paintings. Migration
`0039_shared_people_credits` retains the physical `authors` table, its UUIDs,
slugs, biographies and media; shared person APIs use the same rows. No duplicate
person table or synchronized copy is maintained. Legacy author routes and book
directories filter `person_domains.kind = 'book'`; identity pickers can find any
person so that a filmmaker who writes a book is reused.

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

Shared relations: `domains` (1:N), `aliases` (1:N), `credits` (1:N → `work_credits`).
Shared creation, sparse editing, deletion and audited merges are atomic. Shared
deletion refuses credited people. The legacy book deletion action retains its
book behavior, but non-book credits restrict deletion and roll back associated
comment/activity cleanup. Distinct credit IDs survive merges; duplicate book
memberships keep the target credit and retain the source in the merge archive.
Shared edits keep the URL stable; same-name creation retries slug collisions.

### `person_domains` and `person_aliases`

`person_domains` has composite PK `(person_id, kind)`, with a cascading FK to
`authors.id` and `work_kind_enum`. Existing people receive book membership.
Legacy author inserts default to book membership; shared creation replaces this
with explicitly selected domains in the same transaction. Adding a credit adds
the corresponding domain. Removing a credit does not erase a person's domain.

`person_aliases` has composite PK `(person_id, name)` and a cascading person FK.
Names must contain 1–300 trimmed characters. Generated `search_text` uses
`search_normalize(name)` and a GIN trigram index. Shared search matches canonical
names and aliases, with domain filtering and deterministic pagination before
returning at most 100 lightweight identities; its count uses the same predicate.

### `credit_roles` and `work_credits`

`credit_roles` defines an immutable `id`, `kind`, `level` (`work` or `edition`),
display `label` and optional `legacy_role`. `(kind, level, legacy_role)` is unique.
The migration seeds book work/edition roles, film cast/crew, perfume perfumers
and creative directors, and painting painters. Historical custom book role
strings receive deterministic registered IDs, preserving all old contributions.
Triggers reject changing a role's scope or deleting a role used by book credits.

`work_credits` stores repeatable **non-book work** contributions:

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK, auto-generated |
| `work_id` | UUID | NOT NULL, FK → `works.id`, CASCADE |
| `person_id` | UUID | Nullable, FK → `authors.id`, RESTRICT |
| `role_id` | TEXT | NOT NULL, FK → `credit_roles.id`, RESTRICT |
| `credited_as` | TEXT | Nullable credited name |
| `attribution` | attribution_enum | NOT NULL, default `unspecified` |
| `characters` | TEXT[] | NOT NULL, default empty; at most 50 non-null entries |
| `notes` | TEXT | Nullable |
| `sort_order` | INTEGER | NOT NULL, nonnegative, default 0 |
| `created_at` | TIMESTAMPTZ | NOT NULL, default now |

Attribution values: `unspecified`, `confirmed`, `attributed`, `uncertain`,
`anonymous`, `unknown`. A credit requires a person, credited name, or explicit
anonymous/unknown attribution. The same person and role may occur repeatedly.
Only `film.cast` accepts character labels (each nonblank, at most 300 characters);
cast roles do not infer gender. Database triggers validate work kind and role
level. Indexes cover `(work_id, sort_order, id)` and `person_id`.

Books continue to use the canonical junctions below; shared credit APIs adapt
them rather than duplicate their data. Ordered replacement locks the owner,
checks a snapshot for overlapping edits and writes atomically. Provided credit
IDs must already belong to that owner. A person's cross-domain credits are
unioned, ordered and paginated together.

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
| `id` | UUID | NOT NULL, UNIQUE, auto-generated stable credit ID |
| `credited_as` | TEXT | Nullable |
| `attribution` | attribution_enum | NOT NULL, default `unspecified` |

**PK**: `(work_id, author_id, role)`

Roles: `author`, `co_author`, plus registered historical roles. A trigger enforces
book/work role scope. Legacy membership edits preserve credit IDs and attribution.

### `edition_contributors`

Links contributors to editions with edition-specific roles (translator, editor, etc.).

| Column | Type | Constraints |
|---|---|---|
| `edition_id` | UUID | FK → `editions.id`, CASCADE |
| `author_id` | UUID | FK → `authors.id`, CASCADE |
| `role` | TEXT | NOT NULL |
| `sort_order` | SMALLINT | NOT NULL, default `0` |
| `id` | UUID | NOT NULL, UNIQUE, auto-generated stable credit ID |
| `credited_as` | TEXT | Nullable |
| `attribution` | attribution_enum | NOT NULL, default `unspecified` |

**PK**: `(edition_id, author_id, role)`

Roles: `translator`, `editor`, `illustrator`, `foreword`, `afterword`, `introduction`, `narrator`, `photographer`, `compiler`, `contributor`, `other`, plus registered historical roles. A trigger enforces book/edition role scope.

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

Migration `0040_shared_organizations` extends the existing identity row into the
shared organization root while retaining its physical table name and every
publisher UUID. Common identity fields and aliases remain in one canonical
store. The existing `kind`/`parent_id` pair is an optional book profile, not a
classification for all organizations. Shared APIs use organization terminology;
legacy publisher readers require a non-null book profile. Names are **not unique**:
unrelated organizations can share a name. Country and website distinguish them.
Existing URLs remain stable; new shared identities use a name plus UUID suffix
for deterministic collision handling under concurrent creation.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `name` | TEXT | NOT NULL; indexed, not unique |
| `slug` | TEXT | UNIQUE, NOT NULL |
| `country` | TEXT | nullable |
| `country_id` | UUID | FK → `countries.id`, SET NULL |
| `kind` | TEXT | Nullable book profile, default publisher: `group`, `publisher` or `imprint`; NULL for an organization without a book publishing profile |
| `parent_id` | UUID | FK → publishing_houses.id, RESTRICT; an imprint's publisher (required), a publisher's group (optional), NULL for a group and for organizations without a book profile |
| `is_favourite` | BOOLEAN | NOT NULL, default false |
| `notes` | TEXT | Personal collecting notes, nullable |
| `description` | TEXT | nullable |
| `website` | TEXT | nullable; web writes accept HTTP(S) URLs |
| `search_text` | TEXT | GENERATED ALWAYS from search_normalize(name), GIN trigram index |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

Three levels, as the book trade uses them (migration 0036, task 0179): a **group** owns publishers (Penguin Random House), a **publisher** owns imprints (Knopf Doubleday Publishing Group), and an **imprint** is the brand printed on the book (Vintage International). ONIX for Books keeps imprint and publisher apart; library cataloguing records the imprint. A trigger allows only imprint → publisher → group parents; types and parents may change when ownership changes, as long as the houses below still fit, and every change is logged in `publisher_hierarchy_changes`. Books stay on their imprint, so a move does not rewrite them. `publisher_family(root)` returns a house and every house below it; publisher pages, counts, the library publisher filter and `target_accepts_edition` roll up through it. The approved structure and its evidence rules live in `src/lib/publishers/taxonomy.ts` and are applied by `scripts/publishers/taxonomy.ts` (dry run by default). Sellers remain `venues`, not publisher identities.

Shared organizations (migration 0040): a museum, retailer or perfume house has
`kind = NULL` and `parent_id = NULL`; shared creation never defaults one to
publisher. Book links (`edition_publishers`, acquisition targets, specialties,
ISBN prefixes, automatic decisions) require a book profile, publisher name
matching ignores organizations without one, and a house that books use keeps its
profile. The taxonomy engine only reads houses with a profile. Shared CRUD and
audited merges are transactional; merges require compatible book profiles and
preserve roles, aliases and venue links.

### `publisher_aliases`

Canonical organization aliases: `publisher_id` (UUID, FK → publishing_houses,
CASCADE) and `name` (TEXT, NOT NULL), composite PK. The physical legacy name is
retained. Generated `search_text = search_normalize(name)` has a GIN trigram
index. The same alias may belong to different identities; shared search presents
those choices with consistent role-filtered counts and bounded pagination.
The legacy `publisher_candidates` function considers only book profiles, so a
same-named museum cannot create an ambiguous book publisher match. Non-publishing
organization or alias edits do not rematch book editions.

### `organization_roles`

Composite PK `(organization_id, role)`; organization FK → `publishing_houses.id`,
CASCADE. Allowed roles are `perfume_house`, `brand`, `manufacturer`, `retailer`,
`production_company`, `distribution_company`, `museum`, `gallery`. A role-leading
index supports directory filters. Book roles are derived from the canonical
optional book profile, not duplicated here. An organization may have any number
of independent roles. A house or brand is not inferred to be its manufacturer or
retailer. Shared entry requires at least one explicit role; no address is required.

### `organization_venues`

Composite PK `(organization_id, venue_id, role)`, with role `operator` or `owner`.
Both foreign keys use RESTRICT: deleting an organization or venue cannot silently
discard its affiliation. An institution can operate multiple branches, and a
venue can have separate owner and operator organizations. Explicit unlinking
removes only that affiliation. This relationship does not imply original-art
custody or ownership. An `operator` link that a perfume retailer listing uses
cannot be removed (deferred constraint trigger).

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

### Families, storage and applicability

`taxonomy_families` is the canonical family registry: UUID `id`, unique `name`
and `slug`, optional description/icon/color, `is_system`, optional `system_table`,
legacy `entity_level`, `hierarchical`, `sort_order` and creation timestamp.
Existing system families keep their dedicated vocabulary and junction tables.
Custom families and the new domain vocabularies use `custom_taxonomy_items`
with UUID identity, family FK, name, family-unique slug, description, color,
parent, sort order and creation timestamp. Work and edition links retain their
existing composite keys and foreign keys. No prior IDs or assignments are moved.

Migration `0041_taxonomy_applicability` adds `taxonomy_applicability`:

| Column | Type | Constraints |
|---|---|---|
| `family_id` | UUID | FK → taxonomy_families, CASCADE |
| `kind` | work_kind_enum | NOT NULL |
| `level` | TEXT | NOT NULL; valid domain/level combination required |

Composite PK `(family_id, kind, level)` and lookup index `(kind, level, family_id)`.
Every domain accepts `work`; only books accept `edition`, perfumes accept
`perfume_variant`, films accept `film_version`, and paintings accept `art_object`.
The migration backfills both the legacy declared level and actual custom links,
so a historical family used at both book levels retains both sets of assignments.
New legacy family inserts default to book applicability. Custom scope changes
are explicit; a used scope cannot be removed or silently changed.

Family management (SLN-353, `src/lib/actions/taxonomy-families.ts`):

- `createTaxonomyFamily` takes explicit scopes (at least one) and writes the
  family and exactly those scopes in one transaction; the insert trigger's
  default book scope is removed when it was not chosen. The slug is derived from
  the name (`mood`, `mood-2`) and never changes; renames keep the URL.
- `updateTaxonomyFamily` changes name, description, icon, color and, for custom
  families, hierarchy and scopes, in one transaction. System families keep their
  storage, hierarchy and scopes.
- `getTaxonomyFamilyUsage` reports the item count and, per scope, whether
  records use it (`taxonomy_scope_in_use`), so editors lock used scopes before a
  save is refused.
- `deleteTaxonomyFamily` removes a custom family with all its items only when no
  scope is in use; otherwise nothing changes and the message names the reason.
- `reorderFamilies` gives the listed families positions 0..n-1; families not
  listed (those of collections that are not open yet) follow, in their order.
- The directory lists families with at least one scope in an enabled domain.
- `getTaxonomyAssignments` lists the custom-item families that apply to a work or
  book edition with its items; `searchTaxonomyItems` returns at most `limit`
  items of one family, best matches first, and whether more exist. Built-in book
  families keep their own editors; perfume notes keep their positioned editor.

Subjects, themes and keywords are shared work vocabularies. Art types and
movements retain book applicability and also apply to paintings. Book genres
and tags remain edition vocabularies. Separate built-in families are:

| Vocabulary | Domain | Levels |
|---|---|---|
| Film genres | Film | Work |
| Perfume families, accords, notes | Perfume | Work, variant |
| Painting genres | Painting | Work |
| Painting techniques, media, supports | Painting | Work, art object |

These built-ins are protected family definitions in the custom-item store.
The migration refuses to commandeer an existing name/slug that conflicts with a
new built-in. No example items or fabricated classifications are seeded.

Assignment triggers call `taxonomy_require_scope(family, kind, level)` under a
scope-row lock. All current work/edition stores enforce applicability, including
direct SQL writes. Future variant/version/art-object junctions must use this same
guard and extend the scope-in-use/deletion checks when their actual domain tables
are introduced; this foundation does not create placeholder targets.

The typed storage registry controls reads and mutations. Item edits, moves,
reordering and assignment validate family membership. Shared work/edition
assignment and multi-family book edits are atomic. Taxonomy merges use the
audited merge transaction, preserving links at every level and reparenting
children before deleting the source. Linked items and nonempty families require
reassignment/removal of their contents before deletion. Built-in family storage
and legacy level identity are immutable.

Hierarchy triggers reject same-item, ancestor cycles and cross-family parents.
An advisory transaction lock serializes concurrent hierarchy edits. Migration
preflight reports invalid historical trees without changing them. Existing
stored depths survive migration; future category/theme/literary-movement edits
maintain one-based depth across the affected subtree, including deeper trees.
New item slugs use the normalized name plus UUID, supporting Unicode-only names
and colliding transliterations. Renaming an item preserves its URL.

Legacy taxonomy pages remain book-scoped. Domain applicability queries and
assignment services support downstream domain interfaces; their distinct
taxonomy controls are delivered separately.

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

Images attached to works, people, collections, organizations, art objects or perfume formulations. Exactly one owner per row, each a real foreign key.

| Column | Type | Constraints |
|---|---|---|
| `id` | UUID | PK |
| `work_id` | UUID | FK → `works.id`, CASCADE, nullable |
| `author_id` | UUID | FK → `authors.id`, CASCADE, nullable |
| `collection_id` | UUID | FK → `collections.id`, CASCADE, nullable (migration `0029_collection_media`) |
| `organization_id` | UUID | FK → `publishing_houses.id`, CASCADE, nullable (migration `0049`) |
| `art_object_id` | UUID | FK → `art_objects.id`, CASCADE, nullable (migration `0049`) |
| `perfume_variant_id` | UUID | FK → `perfume_variants.id`, CASCADE, nullable (migration `0049`) |
| `type` | TEXT | NOT NULL (`'poster'`, `'background'`, `'gallery'`; collections use poster and background; organizations, art objects and perfume formulations use poster and gallery) |
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
| `original_s3_key` | TEXT | nullable. The kept original: the colour original of an author portrait, or the full-resolution copy of a painting or art object image. |
| `processing_params` | JSONB | nullable. Monochrome processing parameters: `{ grayscale: true, contrast: number, sharpness: number, gamma: number, brightness: number }`. Author media only. |
| `color_palette` | JSONB | nullable. Extracted color palette for poster images. Contains raw Vibrant swatches (vibrant, muted, darkVibrant, darkMuted, lightVibrant, lightMuted), dominant color from sharp stats, and a post-processed `crystal` array of 3-4 colors ready for ambient rendering. Extracted at upload time via node-vibrant. |
| `sort_order` | SMALLINT | NOT NULL, default `0` |
| `caption` | TEXT | nullable |
| `alt_text` | TEXT | nullable, 1–1000 characters. Describes the image for people who cannot see it |
| `credit` | TEXT | nullable, 1–500 characters. Creator or holder credit line |
| `license` | TEXT | nullable, 1–200 characters, such as "Public domain" or "CC BY-SA 4.0" |
| `license_url` | TEXT | nullable, HTTP(S) |
| `source_url` | TEXT | nullable, HTTP(S). Set automatically for images added from a URL |
| `source_record_id` | UUID | FK → `source_records.id`, nullable. Must belong to the same record as the image (`media_source_guard`) |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto |

**Check constraints**: `media_owner_check` — exactly one of the six owner columns; `media_type_check` — the owner's image types (above); `media_attribution_check` — lengths and HTTP(S) URLs. Migration `0049` stops with an error, and changes nothing, if an existing row has an unknown type or a collection gallery.

**Check constraint** `media_applied_crop_check`: `num_nonnulls(uncropped_s3_key, applied_crop) in (0, 2)` — both set, or neither.

**Indexes**: `(work_id, type, is_active)`, `(author_id, is_active)`, `(collection_id, type, is_active)`, and `(owner, type, is_active)` for each new owner.

**Domain image policy** (`src/lib/media/policy.ts`): the owner and its domain set the stored sizes and the frame. Book and film posters are portrait (1600×2400, focal crop); perfume and formulation posters are square and contained (2000×2000); painting and art object images are native and contained (4096×4096) and keep a full-resolution, metadata-free original in `original_s3_key`; backgrounds are landscape. `imagePresentation()` (`src/lib/media/presentation.ts`) turns a policy and a row into the frame ratio, fit, focal point, scale and alt text; contained frames ignore any crop, so artworks are never cut.

**One ingest path** (`src/lib/media/ingest.ts`): every upload route renders the sizes, stores the files, then records the row and makes a poster or background active in one transaction. If storing or recording fails, the files already stored are deleted again.

**Saved crops** (`src/lib/media/display.ts`): a crop on a poster or background is written into new display files at the owner's policy sizes; the uncropped image stays in `uncropped_s3_key`. A contained image (perfume, painting, art object) is never cropped. Replaced files are removed through the shared cleanup (`src/lib/s3/cleanup.ts`), which counts `uncropped_s3_key` as in use.

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
| `venue_id` | UUID | FK → `venues.id`, RESTRICT, nullable | Venue / seller from which the order was placed; archive the venue instead of deleting it |
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
| `venues` | `orders.venue_id` | RESTRICT |
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

Real-world and online establishments where works are acquired, browsed, seen or experienced: bookshops, museums, galleries, perfumeries, cinemas. This is the "Places" section of the catalogue. Venues stay separate from geographic `places` and from personal storage `locations`.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | UUID | PK, auto-generated | |
| `name` | TEXT | NOT NULL | Venue name, 1–500 characters after trim |
| `slug` | TEXT | UNIQUE, nullable | URL slug. New venues get `<name>-<uuid>` in the same write; a rename never changes it |
| `type` | `venue_type_enum` | NOT NULL | Category: `bookshop`, `online_store`, `cafe`, `library`, `museum`, `gallery`, `auction_house`, `market`, `fair`, `publisher`, `individual`, `other`, `perfumery`, `cinema` |
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
| `archived_at` | TIMESTAMPTZ | nullable | Set when archived. Archived venues leave default lists and counts but keep their URL and history |
| `search_text` | TEXT | GENERATED, STORED | `search_normalize(name + formatted_address)`; trigram GIN index `venues_search_idx` |
| `created_at` | TIMESTAMPTZ | NOT NULL, auto | |
| `updated_at` | TIMESTAMPTZ | NOT NULL, auto | |

**Relations**: `place` (N:1 → `places`, optional); organizations through `organization_venues`; perfume retailer listings through `perfume_retailer_links.venue_id`.

**Enum `venue_type_enum`**: `bookshop`, `online_store`, `cafe`, `library`, `museum`, `gallery`, `auction_house`, `market`, `fair`, `publisher`, `individual`, `other`, `perfumery`, `cinema`. The TypeScript source is `VENUE_TYPES` in `src/lib/catalogue/venues.ts`.

**Rules (migration 0045)**:

- The trigger `venue_write_guard` rejects a blank or over-long name, a rating outside 1–5 and a last visit before the first visit. The migration stops with an error, and changes nothing, if an existing venue breaks these rules.
- Deletion is blocked when orders, identifiers, source observations or artwork location history reference the venue (RESTRICT and `venue_delete_guard`). Use archive and restore instead. A deleted venue's images are removed after commit unless another row still uses them (`src/lib/s3/cleanup.ts`).
- Online establishments need no address or place. Coordinates without a `place_id` create an `address` place in the same atomic write.
- Create, edit and search inputs are validated with Zod (`src/lib/validations/venues.ts`). Results and counts share one filter builder, so they cannot disagree.

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
