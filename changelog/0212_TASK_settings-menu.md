# Task 0212: A Real Settings Menu

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-406. `/settings` (`src/app/settings/page.tsx`) is four cards of fixed text: nothing can be changed, "Database: Connected" and "Version 0.1.0" are literals, and only the Google Books key is listed. The real defaults are hard-coded or scattered across cookies and localStorage. This task replaces the page with a settings menu of seven parts, each its own page under `/settings`, with a menu on the left (a row on small screens):

1. **General** (`/settings`), saved in the database, so it applies on every device:
   - New books: status (`tracked` today) and language (`en` today), used by the add-book wizard and Fast Track.
   - New copies: location (picked by name today: "amsterdam", then "mexico city"), format (`paperback`), condition (`mint`), used by the wizard and the add-copy dialog; the default location also sorts first in the location list.
   - Orders: home currency. New orders start in it, orders without a currency get it when edited, and spending totals list it first.
2. **Display** (`/settings/display`), this browser (cookies): sidebar collapsed; each list's view, grid size and page size; reset all.
3. **Reader** (`/settings/reader`), this browser: font, size, line height, margins, alignment, with a preview.
4. **Integrations** (`/settings/integrations`): an on-demand live check per outside service, Calibre sync freshness, API token state. Never renders a secret.
5. **Data** (`/settings/data`): catalogue counts, review queues with counts, whole-catalogue export, refresh cached data.
6. **Shortcuts** (`/settings/shortcuts`): the keyboard reference.
7. **About** (`/settings/about`): versions, environment, migration state, storage, collections.

## Implementation Details

### Research (five read-only agents, 2026-10-03)

- **Preferences**: no settings or key-value table exists. View mode, grid size and column set per list are `durtal-*` cookies through `usePreference` (`src/lib/hooks/use-preference.tsx`); page size is a per-path cookie read by `src/proxy.ts`; sidebar width (`durtal-sidebar-width`) and reader typography (`durtal-reader-settings`) are localStorage, so the server renders defaults and the page jumps after load. Both hold JSON-compatible values, so `usePreference` with the same key migrates them automatically. Key strings are repeated in 2–3 files per list page.
- **Domains** (`WORK_DOMAINS[kind].enabled`) are a release gate tied to the database check `works_kind_enabled_check`, not a setting. Only Books is open; Settings shows the others as "in development" (About).
- **Integrations**: `/api/health` checks nothing and must stay that way (Docker polls it every 30 s; external probes there would spend quota and keep Neon awake). Probes must use a raw `fetch` with `cache: "no-store"` and `fetchWithTimeout` (`src/lib/api/external-fetch.ts`), never echo URLs, headers or bodies (Google Books puts the key in the query string). Probe ISBN `9780857865618`. S3: `HeadBucketCommand` (the IAM user cannot call GetBucketLocation); its `BucketRegion` shows a wrong `AWS_REGION`. Mapbox: check from the browser (URL-restricted tokens fail server-side). Wikidata is used by scripts only: show the last use (`max(retrieved_at)` from `source_records` where provider is wikidata). Calibre: `count(*)`, `count(work_id)`, `max(last_synced)` from `calibre_books`.
- **Tokens**: `DURTAL_API_TOKEN` protects 11 REST write handlers (`src/lib/api/rest.ts`). `ADMIN_TOKEN` is fail-open: unset, `/api/media/{apply-crops,backfill-palettes,reprocess}` run for anyone. Show status only.
- **Data**: export (`src/app/api/export/route.ts`) takes 1–500 ids; a whole-catalogue export needs an `all` scope. Cheap counts: identify queue (`editions.metadata_source = 'phantom_canon'`), series suggestions (one query). Publisher names and Harmonize are expensive: link only. No action clears the cache: add one that invalidates every `CACHE_TAGS` tag and the root layout.
- **Migrations**: drizzle applies journal entries whose `when` is newer than the newest `created_at` in `drizzle.__drizzle_migrations`; compare those for the About page (counts do not match because 0000/0001 are not recorded).

### What was built

**Storage.** `app_settings`, one row (`src/lib/db/schema/app-settings.ts`, migration `0052_app_settings`): `new_book_status`, `new_book_language`, `new_copy_location_id` (FK, `ON DELETE SET NULL`), `new_copy_format`, `new_copy_condition`, `home_currency`, `updated_at`; checks for the single row, the status (not deaccessioned), the language and currency shape. The migration seeds today's behaviour (Amsterdam, else Mexico City; tracked; en; paperback; mint; EUR). Landed alone on fix/backlog-0116-0121 as `1eb9f22`, so the live database and the branch match.

**Actions** (`src/lib/actions/settings.ts`): `getAppSettings` (cached, tag `ref:settings`; a stored value the app no longer offers falls back per field; the defaults while the table is missing, error 42P01), `updateAppSettings` (partial, zod in `src/lib/validations/settings.ts`, result object, invalidates the tag and the root layout), `refreshCachedData` (every `CACHE_TAGS` tag and the root layout). `src/lib/actions/integrations.ts`: `checkIntegration`. Server-only modules: `src/lib/settings/integrations.ts` (service list, checks), `data.ts` (counts, queue counts), `about.ts` (schema state by journal time).

**Defaults wired.** The root layout passes `getAppSettings()` to `AppSettingsProvider` (`src/lib/hooks/use-app-settings.tsx`).
- Add-book wizard and Fast Track: status and language start from the settings; a search result without a language takes the setting; copy drafts start with the format and condition; the copies step fills the default location (`newCopyLocationId` in `src/lib/utils/instance-drafts.ts` replaces the name match `pickDefaultLocationId`); an added copy also starts there.
- Add copy dialog: starts with the default location, format and condition (before: no location). `InstanceForm` lists the default location first (the duplicate `PREFERRED_LOCATIONS` name list is gone); `getLocations` orders equal sort orders by name.
- Add edition dialog: the language starts from the setting.
- Orders: both dialogs start in the home currency; `getProvenanceStats` lists it first (`sortCurrencyTotals(rows, homeCurrency)`). The last-used currency memory (`durtal:preferred-currency`, `preferredCurrency`, `rememberCurrency`) is removed: a setting must not be overridden by a hidden memory.
- `deleteLocation` also invalidates `ref:settings`.

**Display preferences.** `src/lib/preferences.ts` is the one registry of preference keys and defaults (sidebar, reader, and each list's view, grid size and columns); the list pages, the view switcher labels and the authors map read it instead of string literals. The sidebar width and the reader typography move from localStorage to `usePreference` cookies under the same keys (the hook migrates the old values once), so the server renders them: no jump after load, and the settings pages stay in sync with the pages that change them. `clearPreferences`, `deleteCookie` and `preferenceCookieNames` support the reset. `DEFAULT_PER_PAGE` names the 48. The reader's choices (`READER_FONTS`, sizes, line heights, margins, alignments) and `readerSettings` validation live in `epub-theme.ts`; the reader's own panel uses them too.

**Settings UI.** `src/app/settings/layout.tsx` with `SettingsNav` and seven pages (General, Display, Reader, Integrations, Data, Shortcuts, About). Parts: `SettingsGroup` (`SectionHeading` over a panel; a group action sits on the title's cap-height center through `CapAlignedControls`), `SettingRow` (control on the name's cap-height center, or `stacked`), `SettingFact`, `SettingsIntro`. New controls: `Switch` (role switch, squared) and `SegmentedControl` (radio group: one Tab stop, arrow keys). `Select` takes `ariaDescribedby`. The command palette finds each part ("Settings: Display"…). Export: `POST /api/export` takes `all: true` (every book or every book author; the acquisition target lookup is asked in batches of 500); `triggerExport` and `EXPORT_FORMAT_LABELS` are exported for Settings → Data.

**Fixed in passing.** The sidebar search icon had a 2px stroke (now 1.5). Two integration-test mocks of `@/lib/cache` gain `cached`, since `orders.ts` now loads the settings actions.

**Docs.** 02 (`app_settings`, cascade, summary), 04 (routes, the Settings section), 05 (`POST /api/export`), 06 (settings actions).

## Completion Notes

Done on 2026-10-03. Branch `pabloagn/sln-406-settings-menu`; the schema commit `1eb9f22` is on fix/backlog-0116-0121.

**Migration.** Backup `~/personal/durtal-backups/live-before-app-settings-20261003-220818.dump` (pg_dump 16, 108 table data entries). Rehearsal on it (`scripts/qa/preview-local.py --from-dump`): 107 tables, 21,011 rows, 0 differences; new table `app_settings`, 1 row. The migration was regenerated right before applying (`when` 1791058969457, SQL identical to the rehearsed file). Live journal before: 51 rows, max 1791021759614; after: 52 rows, max 1791058969457. The live row holds the seeded values (Amsterdam, tracked, en, paperback, mint, EUR).

**Behaviour, checked in the browser.**
- On the rehearsal copy: each General setting saved and read back from the database; the wizard started as Wanted / Spanish; the Add copy dialog started at Calibre / ebook / no condition with Calibre first; a new order started in MXN; Display changed Books to List and 96 per page (the list opened that way, via `?perPage=96`) and collapsed the sidebar (56px, rendered by the server); the reset deleted every display cookie and kept the reader's; the reader preview followed font, size, line height (arrow keys), margins and alignment.
- On live with the real keys: Neon 55 ms, S3 189 ms (bucket region eu-north-1 matches `AWS_REGION`), ISBNdb 238 ms, Open Library 543 ms, Nominatim 100 ms, Mapbox 228 ms (browser), Wikidata 258 ms. Google Books, without a key: over the shared quota (429). Google Places: refused (403); the app's own `/api/venues/search-places` fails the same way, so the key or the API needs attention in Google Cloud. REST writes: protected. Media maintenance routes: open (`ADMIN_TOKEN` unset). A home-currency change on live saved only that field and was set back to EUR. Data counts match the database (660 books, 671 editions, 227 copies, 222 placeholder editions).
- Export: every book, 660 rows and 21 columns (CSV 204 KB, TSV 190 KB, Parquet 242 KB); every author, 2,166 rows; a list of ids still works.

**Measurements** (1440×900; `scripts/qa/alignment-audit.js`, `design-audit.js`, and a cap-height probe for controls the audit does not measure):

| Page | Icons checked | Over 0.5px | Low contrast | Unnamed | Nested |
|---|---|---|---|---|---|
| General | 21 | 0 | 0 | 0 | 0 |
| Display | 37 | 0 | 0 (6 before: the "—" cells in `fg-muted`) | 0 | 0 |
| Reader | 15 | 0 | 0 | 0 | 0 |
| Integrations | 26 | 0 | 0 | 0 | 0 |
| Data | 18 | 0 | 0 | 0 | 0 |
| Shortcuts | 15 | 0 | 0 | 0 | 0 |
| About | 15 | 0 | 0 | 0 | 0 |
| /library | 27 | 0 | 0 | 0 | 0 |
| Add copy dialog | 29 | 0 | 0 | 0 | 0 |

- Controls against the cap-height center of their name: every setting row 0.01px; the Display list selects −0.18px; the queue counts 0.19px; the switch 0.01px; the group actions ("Check again", "Reset to defaults") 0.01px (3.56px before `CapAlignedControls`). Key caps on the Shortcuts page sit on the label line (0px). The Display column captions line up with the columns to the pixel (522, 808, 960, 1112).
- Font sizes are on the scale everywhere but one: the reader preview paragraph shows the reader's own size (22px here) by design. Icon strokes all 1.5.
- 390px: no horizontal overflow on the seven pages (the export row puts its controls under the text to fit).
- `npx tsc --noEmit`: 0 errors. ESLint on every changed file: 0. Vitest: 969 passed, 387 skipped (integration suites without a test database).

**Deviations.**
- The last-used currency memory is gone; the home currency is the one rule.
- The Add copy dialog now starts with the default location, format and condition, as the wizard does.
- Not built: the `sources` table that Harmonize links to `/settings` is unused by the app (14 seeded link sources, no foreign keys), so no Sources section.

**Note.** The rehearsal server and a live-data server in the same worktree share its `.next` data cache: the live server first showed the rehearsal's cached settings and lists. Settings → Data → Refresh cached data cleared it. Clear `.next/dev/cache/fetch-cache` (or refresh) before pointing a server at another database.
