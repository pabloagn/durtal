# Durtal: curated personal library

Status: architecture and delivery plan; proposed domain features are not shipped.
Baseline: 0e11740 (harmonization landed during the review), plus the existing local author-search changes reviewed on 2026-09-30.
User direction: plan the complete expansion, create its Linear backlog, then begin implementation.

## Outcome and boundaries

Durtal becomes one personally curated library spanning books, perfumes, films and paintings. Each domain has a distinct home, cards, filters, creation flow and detail layout. Curation does not require ownership, consumption logs or an edition. Existing books, their UUIDs, URLs, editions, instances, files, collections and acquisition history must survive.

The first delivery is the substrate and compatibility foundation. New domains are enabled only after their data, actions, queries and UI pass their release gates. Manual entry is a complete supported path. Metadata enrichment follows and cannot be required to save a record. Streaming playback, commerce checkout, social features, exhaustive museum inventory and automatic scraping are outside this scope.

## Findings from the code

- `works` is a useful common identity but currently includes book language defaults, anthology/series fields, Goodreads links and acquisition statuses. `work_type_id` is descriptive taxonomy, not a trustworthy discriminator; never infer medium from it or from art taxonomies already attached to books.
- Book editions and instances carry ISBNs, publishing and Calibre semantics. Preserve this mature three-tier model for books. Other domains need equivalent conceptual distinctions where meaningful, not synthetic ISBN editions.
- `authors` already contains reusable person identity, biography, geography and media. Work credits currently allow only author/co-author in application validation. Film cast requires repeatable credits, billing order and characters; identity and profession must be separate.
- `publishing_houses` has valuable aliases, publisher/imprint constraints and acquisition-target links. It cannot stand in for every organization by relabeling it.
- `venues` already includes museum/gallery and physical/online establishments; `places` is geographic hierarchy; `locations` is personal storage. These three concepts must remain distinct.
- Taxonomy families and custom items exist, but only work/edition levels are supported and system-family actions remain partly hard-coded. Genres and tags are currently edition-level. Existing art-type links classify books too; preserve their meaning.
- Collections contain editions, so an unowned painting cannot currently join one. Add work membership without collapsing edition-specific memberships.
- Media uses real foreign keys and an exactly-one-owner check. S3 processing preserves aspect ratio, but posters/thumbnails and page components assume portrait books. Comments/activity use entity type/id and require careful cleanup.
- Search, dashboard counts, author works, series, recommendations, exports, acquisition actions, importers, TUI/REST, reader and harmonization contain book assumptions. A new kind column alone is unsafe to activate.
- Repository docs lag implementation: installed Next.js is 16.2.1 and current statuses include tracked/shortlisted/wanted/on_order/accessioned/deaccessioned. The code and generated migration history are the implementation baseline.
- Existing unrelated local changes include migration 0032 and harmonization. Preserve them and reserve migration numbers against that history. No live database changes during development.

## Architecture decisions

### 1. Shared work identity, explicit domain modules

Retain `works.id` as the shared work identifier. Add immutable `kind: book | perfume | film | painting`, defaulting existing and legacy inserted rows to book. Classification is explicit; titles, work types and taxonomy labels never determine kind.

Keep common identity, title, description, personal notes/rating and timestamps in the shared root. Add typed one-to-one domain profiles (`film_details`, `perfume_details`, `painting_details`) and typed child tables. Book fields remain behind the book adapter during expand-and-contract migration; move columns only after all callers are switched and verified. Nonlinguistic records must not acquire a fictional English original language.

A small exhaustive TypeScript domain registry owns labels, canonical paths, creator role vocabulary, supported capabilities and media presentation defaults. Domain modules own validation, persistence, filters and page composition. Do not build an EAV/JSON metadata bag, a dynamic plugin platform, or one page with dozens of kind conditionals. JSON is appropriate only for source payloads and nonrelational presentation settings.

Subtype integrity is enforced in PostgreSQL as well as Zod: composite foreign keys or equivalent checks tie child rows to the expected work kind. Changes of kind are rejected; corrections require a reviewed migration. Unknown creators, dates and whereabouts are representable without dummy records.

### 2. Domain-specific levels

| Domain | Work | Specific realization | Owned/accessed object |
| --- | --- | --- | --- |
| Books | Literary work | Existing edition | Existing physical/digital instance |
| Perfumes | Fragrance identity | Concentration/formulation variant, with release period | Bottle/sample/decant; capacity, remaining amount, batch and acquisition |
| Films | Film identity | Cut/version; releases carry territory/date/format | Optional physical/digital holding; viewing does not imply ownership |
| Paintings | Artistic work | Original object or explicitly identified version; do not invent an edition | Original custody/location tracked independently of personal ownership; reproductions are distinct objects |

Flankers are separate fragrance works with a typed relation. Bottle sizes are not new works or formulations. Reformulations may be dated/uncertain; no invented formula. Film remakes are separate works; cuts are versions; adaptations link to their source work. A print/reproduction never replaces the original painting. Support multiple identified originals/versions where the work requires it.

### 3. Shared people, organizations and venues

Promote authors into the shared person identity through an ID-preserving compatibility layer. Keep legacy author URLs and book role labels. A person can write a novel, direct a film and paint; do not duplicate them by profession or infer their role from gender.

Credits reference a person plus a domain/level-appropriate role. Preserve ordering, credited-as text, attribution certainty and film character labels. A surrogate credit ID supports multiple roles/characters for one person. Book translators stay at edition level.

Organizations support multiple explicit roles: publisher/imprint, perfume house/brand, manufacturer, retailer, film production/distribution company, museum and gallery institution. Preserve publisher IDs and hierarchy in a profile/compatibility mapping. A brand is not automatically its manufacturer or retailer. A museum institution can operate several venues. Online retailers need no fabricated address. Venue affiliation and work/org roles use foreign keys; geographies and personal storage retain their existing responsibilities.

### 4. Painting originals and whereabouts

Create identifiable art objects with work link, original/reproduction status, accession/catalogue number (scoped to institution), dimensions and units, support/material and attribution. Separate the owning institution, home collection and current physical location.

Store dated, sourced location/custody records with venue or explicit private/unknown location, recorded/verified dates, display status and notes. Distinguish permanent collection, temporary loan, on display, in storage, private collection, unknown, lost and destroyed where relevant. Dates can be incomplete; do not fabricate January 1.

For each object, current confirmed physical location is a single fact; historical/uncertain assertions can coexist but must not silently overwrite it. Updates atomically close the prior confirmed interval and open the next, with concurrency control and overlap/date validation. Venue deletion cannot erase provenance. A work page shows the current original location, owning collection and verification/source separately; a museum holding alone does not imply public display.

### 5. Taxonomies, identifiers and relationships

Retain existing system/custom taxonomy IDs and assignments. Add normalized family applicability across domains and levels (work, book edition, perfume variant, film version, art object, person/organization where justified). Validate links against both family and target. Hierarchies reject cycles and cross-family parents.

Shared themes/subjects/keywords may span domains. Literary genres remain compatible with existing edition classification; film genres belong to films. Perfume families, accords and note vocabulary are distinct; note positions top/heart/base/unspecified are explicit links, with variant overrides and source. Painting movements, genres, techniques, media and supports remain distinct; existing books about art retain their classifications.

External IDs use provider + entity kind + identifier uniqueness; never title alone. Source assertions carry URL/provider, retrieval date, attribution and review/lock state. Partial years, ranges and approximate dates are explicit and sortable without inventing precision. Cross-work relationships (adaptation, inspired by, remake, flanker, reproduction/version links as appropriate) have direction, constraints, source and inverse display. Cross-domain similarity is explainable and optional; preserve the existing book recommendation behavior.

### 6. Curation, collections and acquisition

Notes, rating, favorite, collection membership and personal recommendations apply across domains. Acquisition intent, ownership and consumption are independent. Preserve book lifecycle/status behavior during migration; never promote a painting to personally owned because it has a museum location or mark a watched film as owned.

Add ordered work membership to collections while retaining edition membership. Mixed collections render domain cards and explain whether a chosen book edition or the work is collected. Duplicate display/count behavior is specified and tested. Collections never require placeholder editions.

Keep existing orders/acquisition targets book-scoped until typed targets support other domains. Receiving a perfume order creates a bottle of the intended variant; receiving a film release creates an optional holding. Art custody is independent of purchases. Currency totals stay separated. No generic object-ID columns without integrity checks.

## Product and layout specification

The global dashboard presents the four domains, recent additions and curated mixed collections. Each domain has a dedicated home; domain switching preserves only filters valid in the destination. Navigation and add actions name the domain. Global search groups results by domain and entity type.

Canonical first-release paths: existing books remain `/library` and `/library/[slug]`; new `/perfumes`, `/films`, `/paintings` plus detail/new routes. Add `/people` and `/organizations`; legacy `/authors`, `/publishers`, `/places` links remain valid. No mass URL rename in the first rollout.

| Surface | Books | Perfumes | Films | Paintings |
| --- | --- | --- | --- | --- |
| Home | Library grid, author/series, editions and holdings | Fragrance grid; house, perfumer, family, accords and collection | Film posters; director, cast, year, genre and language | Gallery with generous uncropped art; painter, movement, technique and institution |
| Hero | Current portrait treatment | Contained bottle/product image with house/perfumer identity | Portrait poster with wide still/background | Larger image area; native portrait/landscape/square proportions; contain, no default crop |
| Primary facts | Author, original year/language | House, perfumers, launch period and selected concentration | Year, directors, writers, principal cast and version runtime | Painter/attribution, date/range, medium/support, dimensions |
| Main sections | Editions, copies, provenance, taxonomy, related books | Notes/accords, variants, bottles/samples, retailers, related fragrances | Synopsis, cast/crew, versions/releases, optional holdings, source adaptations | Original object(s), owning collection, current venue/display state, location history, related works |
| Actions | Add edition/copy, read, acquire | Add variant/bottle/sample, note retailer | Add version/release/holding | Record original/location, link institution; add reproduction explicitly |

Desktop painting detail: image gets roughly half the content width, capped by viewport height; facts/location alongside, history below. Mobile: full-width contained image, identity, facts and current location stacked. Exact dimensions belong to verified responsive UI work, not immutable data semantics. Book/film card slots can remain portrait; perfume slots square/contained; painting gallery slots use bounded native aspect ratio. Caption alignment and reading order remain stable, without image cropping to fake equal heights.

Each new page includes full empty/loading/error/not-found behavior, accessible dialogs, keyboard navigation, responsive controls and functional create/edit/delete flows. Related people/org/venue pages display domain-specific sections and counts. A perfumer page is not labeled “Author,” and a museum page emphasizes its collection and current loans, not book order totals.

## Migration and execution order

1. Record baseline, preserve the current local changes and establish a disposable local PostgreSQL harness.
2. Add domain constants/registry and the explicit work kind migration; backfill all existing rows to book. Harden legacy create/update contracts. A database check restricts enabled kinds to book until compatible readers/writers and per-domain prerequisites are delivered. This step exposes no incomplete new pages.
3. Audit and scope every existing book read/write/count/import/export/reader/merge/series/acquisition path. New-kind activation is blocked until isolation and book regression tests pass.
4. Add shared graph/provenance/taxonomy/curation structures using additive migrations, deterministic ID maps and reconciliation reports. Do not delete old columns, junctions, IDs or media paths during expansion.
5. Build and test each domain's relational model and services, then its distinct UI. Complete paintings' original whereabouts path before enabling paintings.
6. Integrate mixed collections, search, activity, media, imports/exports and harmonization. Enrichment is independently gated.
7. Rehearse populated upgrade and rollback/forward recovery, browser QA, query budgets and production build. Enable domains one at a time with data checks and documented recovery.

Cross-table mutations use the actual Neon HTTP transaction mechanism (`atomic`/`db.batch`) or a reviewed single SQL operation for conditional writes. Do not assume interactive transactions work in production because they work in local postgres-js tests. File writes require compensating cleanup and must not report success with missing DB records.

Rollback disables new-domain reads/writes while retaining new data. Restoring an old binary is not safe once it can read new kinds; choose an explicitly compatible rollback build. Never drop new tables to “roll back” after users have entered data. Take verified DB/S3 backups before any later destructive contraction.

## Verification and release gates

- Unit/contract: domain parsing, domain/level applicability, dates/units, credit multiplicity, film versions, perfume note placement and quantity bounds, route selection.
- Database: foreign keys/checks, all-or-nothing writes, duplicate IDs/slugs, stale concurrent updates, original-location intervals and venue-delete behavior. Execute against a disposable local database only.
- Populated migration: counts, UUIDs, URLs, credit ordering, collection edition choices, ISBNs, acquisitions, media/S3 keys and notes preserved. Repeat migration is a no-op; no art-tagged book becomes a painting.
- Workflow: create/edit/reload/search/filter/collect/export/delete each domain; one person across domains; house versus retailer; loaned original with separate owner; unknown creator/location; reproduction does not change original.
- Books: wizard, manual/ISBN creation, editing, edition/copy lifecycle, publishers/imprints, orders, series, collections, Calibre, matching, harmonization and legacy API/TUI still work.
- UI: real browser at 390, 768 and 1440px, keyboard/dialog focus checks, portrait/landscape/square and missing images. Run `scripts/qa/alignment-audit.js` on changed pages and fix deviations over 0.5px.
- Performance: indexed bounded queries, deterministic ordering before pagination, mixed-domain count consistency, no per-card N+1 queries, lazy heavy maps/timelines, warm/cold measurements at representative catalogue sizes.
- Delivery: `pnpm typecheck`, lint for changed code, relevant unit/integration suites, production build and checked migrations. A skipped integration suite is not a passed database test.

## Known existing work to reuse

Link the new issues to existing relevant work rather than silently duplicating or closing it: SLN-343 harmonization; SLN-319 publishers; SLN-281 atomic writes; SLN-312 mobile; SLN-342 alignment; SLN-290/301 taxonomy UI/actions; SLN-292 venue editing; SLN-303 slugs; SLN-284/304 sorting/query duplication; SLN-282/295/300 media; SLN-297 activity; SLN-246 imports; SLN-298 exports; SLN-311 testing; SLN-249 CI; SLN-310 documentation drift.

## Completion accounting

The parent initiative is complete only when all four domains, shared supporting entities, migrations and release gates are delivered. Architecture, schema readiness and visible product functionality are tracked separately. Each implementation issue records changes, verification, limitations and rollout state; unimplemented pages are never advertised as available.

The first foundation implementation (SLN-346) passes 681 tests with all PostgreSQL
integration suites enabled, typecheck and changed-source lint. Its production
build compiles but cannot finish prerendering without database credentials,
matching the existing SLN-283 build-time database dependency. SLN-283 explicitly
blocks SLN-382; resolve it before activating any new domain.

## Linear delivery backlog

Parent: [SLN-345](https://linear.app/sanctum-black/issue/SLN-345).

### 01 · Domain contracts and book compatibility

- [SLN-346: Add explicit work kinds and a typed domain registry](https://linear.app/sanctum-black/issue/SLN-346/add-explicit-work-kinds-and-a-typed-domain-registry).
- [SLN-347: Scope legacy book queries, mutations and integrations before enabling new kinds](https://linear.app/sanctum-black/issue/SLN-347/scope-legacy-book-queries-mutations-and-integrations-before-enabling) — depends on SLN-346.
- [SLN-348: Establish populated migration fixtures and book regression baselines](https://linear.app/sanctum-black/issue/SLN-348/establish-populated-migration-fixtures-and-book-regression-baselines) — depends on SLN-346.

### 02 · Shared people, organizations and classification

- [SLN-349: Promote authors to shared people with domain-aware ordered credits](https://linear.app/sanctum-black/issue/SLN-349/promote-authors-to-shared-people-with-domain-aware-ordered-credits) — depends on SLN-347, SLN-348.
- [SLN-350: Add shared organizations while preserving publisher and imprint identities](https://linear.app/sanctum-black/issue/SLN-350/add-shared-organizations-while-preserving-publisher-and-imprint) — depends on SLN-347, SLN-348.
- [SLN-351: Extend venue relationships for museums, galleries, perfumeries and cinemas](https://linear.app/sanctum-black/issue/SLN-351/extend-venue-relationships-for-museums-galleries-perfumeries-and) — depends on SLN-350.
- [SLN-352: Add domain and record-level applicability to taxonomy families](https://linear.app/sanctum-black/issue/SLN-352/add-domain-and-record-level-applicability-to-taxonomy-families) — depends on SLN-347, SLN-348.
- [SLN-353: Complete taxonomy management and domain-specific assignment controls](https://linear.app/sanctum-black/issue/SLN-353/complete-taxonomy-management-and-domain-specific-assignment-controls) — depends on SLN-352.
- [SLN-354: Separate personal curation, acquisition intent and derived holdings](https://linear.app/sanctum-black/issue/SLN-354/separate-personal-curation-acquisition-intent-and-derived-holdings) — depends on SLN-347.
- [SLN-355: Add typed source identifiers, attribution and uncertain date values](https://linear.app/sanctum-black/issue/SLN-355/add-typed-source-identifiers-attribution-and-uncertain-date-values) — depends on SLN-346, SLN-348.

### 03 · Perfume, film and painting domain models

- [SLN-356: Model fragrances, formulations, note pyramids and personal bottles](https://linear.app/sanctum-black/issue/SLN-356/model-fragrances-formulations-note-pyramids-and-personal-bottles) — depends on SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-355.
- [SLN-357: Implement atomic perfume catalogue and inventory services](https://linear.app/sanctum-black/issue/SLN-357/implement-atomic-perfume-catalogue-and-inventory-services) — depends on SLN-356, SLN-351.
- [SLN-358: Model films, ordered cast and crew, versions and releases](https://linear.app/sanctum-black/issue/SLN-358/model-films-ordered-cast-and-crew-versions-and-releases) — depends on SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-355.
- [SLN-359: Model paintings and distinguish originals from reproductions](https://linear.app/sanctum-black/issue/SLN-359/model-paintings-and-distinguish-originals-from-reproductions) — depends on SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-355.
- [SLN-360: Track sourced current and historical whereabouts of original paintings](https://linear.app/sanctum-black/issue/SLN-360/track-sourced-current-and-historical-whereabouts-of-original-paintings) — depends on SLN-359, SLN-351.

### 04 · Distinct collection experiences

- [SLN-364: Build domain navigation, global dashboard and contextual add flows](https://linear.app/sanctum-black/issue/SLN-364/build-domain-navigation-global-dashboard-and-contextual-add-flows) — depends on SLN-347, SLN-354.
- [SLN-365: Adapt the book experience to the shared substrate without regressions](https://linear.app/sanctum-black/issue/SLN-365/adapt-the-book-experience-to-the-shared-substrate-without-regressions) — depends on SLN-347, SLN-349, SLN-350, SLN-352, SLN-354, SLN-364.
- [SLN-366: Build perfume home, detail and complete editing workflows](https://linear.app/sanctum-black/issue/SLN-366/build-perfume-home-detail-and-complete-editing-workflows) — depends on SLN-357, SLN-364, SLN-361, SLN-353.
- [SLN-367: Build film home, detail, cast/crew and version editing](https://linear.app/sanctum-black/issue/SLN-367/build-film-home-detail-castcrew-and-version-editing) — depends on SLN-358, SLN-364, SLN-361, SLN-353.
- [SLN-368: Build painting gallery, large-image detail and original-location editing](https://linear.app/sanctum-black/issue/SLN-368/build-painting-gallery-large-image-detail-and-original-location) — depends on SLN-360, SLN-364, SLN-361, SLN-353.
- [SLN-369: Build shared people and organization directories with domain-specific sections](https://linear.app/sanctum-black/issue/SLN-369/build-shared-people-and-organization-directories-with-domain-specific) — depends on SLN-349, SLN-350, SLN-364, SLN-361.
- [SLN-370: Build venue pages around collections, exhibitions and retailers](https://linear.app/sanctum-black/issue/SLN-370/build-venue-pages-around-collections-exhibitions-and-retailers) — depends on SLN-351, SLN-360, SLN-357, SLN-364, SLN-361.

### 05 · Cross-library workflows and enrichment

- [SLN-361: Extend media ownership, attribution and domain image presentation](https://linear.app/sanctum-black/issue/SLN-361/extend-media-ownership-attribution-and-domain-image-presentation) — depends on SLN-349, SLN-350, SLN-355.
- [SLN-362: Support ordered mixed-domain collections without losing edition selections](https://linear.app/sanctum-black/issue/SLN-362/support-ordered-mixed-domain-collections-without-losing-edition) — depends on SLN-347, SLN-354.
- [SLN-363: Add sourced cross-work relationships and explainable related works](https://linear.app/sanctum-black/issue/SLN-363/add-sourced-cross-work-relationships-and-explainable-related-works) — depends on SLN-347, SLN-355.
- [SLN-371: Make search, filtering, pagination and counts domain-aware](https://linear.app/sanctum-black/issue/SLN-371/make-search-filtering-pagination-and-counts-domain-aware) — depends on SLN-349, SLN-350, SLN-352, SLN-357, SLN-358, SLN-360.
- [SLN-372: Extend activity, comments, cache invalidation and cleanup to shared entities](https://linear.app/sanctum-black/issue/SLN-372/extend-activity-comments-cache-invalidation-and-cleanup-to-shared) — depends on SLN-349, SLN-350, SLN-357, SLN-358, SLN-360.
- [SLN-373: Make harmonization and merge rules respect domain identity](https://linear.app/sanctum-black/issue/SLN-373/make-harmonization-and-merge-rules-respect-domain-identity) — depends on SLN-347, SLN-349, SLN-350, SLN-352, SLN-357, SLN-358, SLN-360.
- [SLN-374: Add typed acquisition targets for non-book personal holdings](https://linear.app/sanctum-black/issue/SLN-374/add-typed-acquisition-targets-for-non-book-personal-holdings) — depends on SLN-354, SLN-357, SLN-358, SLN-360, SLN-351.
- [SLN-375: Add versioned domain-aware export/import and provider adapter contracts](https://linear.app/sanctum-black/issue/SLN-375/add-versioned-domain-aware-exportimport-and-provider-adapter-contracts) — depends on SLN-355, SLN-357, SLN-358, SLN-360, SLN-362, SLN-363.
- [SLN-376: Add reviewed film metadata lookup and matching](https://linear.app/sanctum-black/issue/SLN-376/add-reviewed-film-metadata-lookup-and-matching) — depends on SLN-375, SLN-358.
- [SLN-377: Add perfume source-assisted entry without conflating variants](https://linear.app/sanctum-black/issue/SLN-377/add-perfume-source-assisted-entry-without-conflating-variants) — depends on SLN-375, SLN-357.
- [SLN-378: Add museum-source artwork enrichment with explicit location verification](https://linear.app/sanctum-black/issue/SLN-378/add-museum-source-artwork-enrichment-with-explicit-location) — depends on SLN-375, SLN-360.

### 06 · Migration rehearsal and release validation

- [SLN-379: Validate all four domain workflows and book compatibility end to end](https://linear.app/sanctum-black/issue/SLN-379/validate-all-four-domain-workflows-and-book-compatibility-end-to-end) — depends on SLN-365, SLN-366, SLN-367, SLN-368, SLN-369, SLN-370, SLN-371, SLN-372, SLN-373, SLN-374, SLN-375, SLN-362, SLN-363.
- [SLN-380: Verify responsive domain layouts, accessibility and measured alignment](https://linear.app/sanctum-black/issue/SLN-380/verify-responsive-domain-layouts-accessibility-and-measured-alignment) — depends on SLN-365, SLN-366, SLN-367, SLN-368, SLN-369, SLN-370, SLN-353, SLN-362.
- [SLN-381: Measure and tune mixed-catalogue query and image performance](https://linear.app/sanctum-black/issue/SLN-381/measure-and-tune-mixed-catalogue-query-and-image-performance) — depends on SLN-371, SLN-361, SLN-365, SLN-366, SLN-367, SLN-368, SLN-369, SLN-370.
- [SLN-382: Rehearse production migration, staged activation and recovery](https://linear.app/sanctum-black/issue/SLN-382/rehearse-production-migration-staged-activation-and-recovery) — depends on SLN-348, SLN-379, SLN-380, SLN-381.

## Implementation verification

The first foundation steps (SLN-346–348) have local implementations. Non-book
creation remains disabled while the shared models and domain experiences are
built. Migrations 0033–0034 preserve existing book identities and add immutable
work kinds and database-enforced book relationships.

Run `pnpm test:local` to provision disposable PostgreSQL databases and execute
the full regression suite. Docker, an installed postgres:16 image and project
dependencies are prerequisites. No production URL or environment file is used.
The runner emits test results and per-migration reconciliation JSON, and removes
its container afterward. `pnpm typecheck` is a separate required check.

Shared people and credits (SLN-349, migration 0035) now preserve the existing
author identity and book junctions while adding explicit domains, aliases and
repeatable non-book credits. Shared mutations are atomic, merges preserve credit
IDs and concurrent replacements reject overlapping edits. The full local run
passes 718 tests with zero skips, plus five Python ingestion tests. The expanded
populated fixture also verifies historical custom roles and book domain backfill.
People directories and the new domain interfaces remain separate delivery work.

Shared organizations (SLN-350, migration 0036) retain publisher identities and
aliases as the canonical root, with an optional book profile and independent
non-book roles. Legacy publisher APIs and database links require that book
profile. Organization/venue affiliations support multiple branches and protect
linked records from deletion. The subsequent full local run passes 728 tests
across 58 files, zero skipped, plus five Python checks.

Taxonomy applicability (SLN-352, migration 0037) now separates domain and record
level while preserving existing vocabulary tables, book art classifications and
edition genres/tags. Work/edition assignments, family boundaries and concurrent
hierarchy changes are guarded. Domain child tables will reuse that contract in
their own migrations. The full local suite passes 738 tests across 59 files,
zero skipped, plus five Python checks.

Typed provenance and dates (SLN-355, migration 0038) now support provider/kind/ID
namespaces, immutable observations, reviewed refreshes, manual locks and uncertain
civil dates. Legacy book provenance remains exposed without backfill. The full
local suite passes 777 tests across 61 files, zero skipped, plus five Python checks.
An additional Neon-driver contract verifies source refresh and lock behavior.

Shared curation (SLN-354, migration 0039) now provides atomic notes/rating/favorite
and recommendation edits independently of acquisition. Book lifecycle fields are
guarded, and typed holdings projections specify personal ownership for each
domain. Persistent non-book projections will be connected in their model tasks.
The full local suite passes 795 tests across 63 files, zero skipped, plus five
Python checks, including the Neon curation transaction contract.

The perfume relational model (SLN-356, migration 0040) now separates fragrance,
formulation/concentration and personal containers. Positioned notes, family and
perfumer inheritance, sourced partial dates and real inventory projections are
implemented. Non-book roots no longer receive a fictional book language. The full
local suite passes 817 tests across 65 files, zero skipped, plus five Python checks.
Perfume services, retailer observations, screens and activation remain their own
delivery gates.

Venues and retailer listings (SLN-351, migration 0041) add perfumery and cinema
venue types, archive/restore, normalized search and validated atomic writes.
Renames keep URLs. Orders, identifiers and source observations now block venue
deletion instead of losing their venue. Perfume retailer listings link a fragrance
or formulation to a retailer and an optional operated branch; price and stock are
append-only dated observations. The migration stops, unchanged, if an existing
venue breaks the new write rules. The full local suite passes 836 tests across 67
files, zero skipped, plus five Python checks. Venue pages were measured at 390, 768
and 1440px; desktop alignment is exact. Phone-width overflow is app-wide and
remains SLN-312.

Perfume services (SLN-357, no migration) create, read, update and delete
fragrances, formulations and containers. Each write is one transaction that
includes every section, guarded by a record fingerprint against concurrent edits.
A supplied section replaces only that section; curation and sources are never
overwritten. Lists filter by house, perfumer, family, accord or note (narrower
items included), release years, holdings and favourites, with counts and results
from one condition. Containers or retailer history block deletion; comments,
activity, layouts and replaced date values go with the record, and artwork is
cleaned after commit. Database rule messages now reach callers as written. The
full local suite passes 853 tests across 69 files, zero skipped, plus five Python
checks, including a Neon-driver contract for perfume writes. Perfume screens and
activation remain SLN-366 and SLN-382; the flanker link itself is SLN-363.

The film model and services (SLN-358, migration 0042) add a film profile with
original title, production countries, languages and companies; ordered cast and
crew through shared credits; versions with runtimes; releases by territory, date,
format and distributor; and optional personal copies. Remakes are separate films
and cuts are versions. Database rules reject cross-film and cross-domain links.
Services follow the perfume pattern: atomic writes, record fingerprints, section
replacement, release lists that keep IDs, and browse filters by person and role,
genre, country, language, release years, copies and favourites, with five sorts.
The full local suite passes 863 tests across 70 files, zero skipped, plus five
Python checks, including a Neon-driver contract for film writes. Film screens
remain SLN-367.

See changelog tasks 0155–0166 for scope and verification. SLN-283 (database access
during production prerendering) remains a prerequisite for release rehearsal.
