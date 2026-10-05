# Routes and Views

## Route Map

```
/                           Dashboard
/library                    Books: the book collection's home (title "Books")
/library/[slug]             Work detail page (slug format: {title}-by-{author})
/library/new                Add new book (wizard); ?q= or ?isbn= searches at once,
                            &then=start or past opens that reading dialog on the new book
/library/import             Bulk import interface
/library/identify           Identify placeholder editions (one at a time)
/people                     People index (every collection; /authors redirects here, 308)
/people/[slug]              Person detail (slug format: {name}; /authors/[slug] redirects here)
/publishers                 Publisher index
/publishers/new             Add a publisher
/publishers/review          Review publisher names on editions
/publishers/[slug]          Publisher detail
/publishers/[slug]/edit     Edit a publisher
/organizations              Organization directory: every collection's houses,
                            studios, museums and shops
/organizations/[slug]       Organization detail (same slug as its publisher page)
/recommenders               Recommender index
/recommenders/[id]          Recommender detail
/reading                    Reading: what is being read now, Up next, the passage
                            of the day, paused, recently finished
/reading/next               Up Next: the books to read next, in order
/reading/journal            Every reading, by year of finish, filtered and sorted
/reading/notes              Notes: every quote and note, searched and filtered
/reading/stats              Stats: a year, or all time, in numbers and charts
/reading/year               Year in review: the years with finished books
/reading/year/[year]        One year's review, made to print
/reading/import             Import reading history: upload, past imports
/reading/import/[id]        One import's preview, decisions, commit and undo
/reader                     Calibre e-book library
/reader/[calibreId]         E-book reader for one Calibre book
/series                     Series index
/series/[id]                Series detail
/series/suggestions         Books that match a series by title
/places                     Venue index (bookshops, stores, fairs)
/places/[slug]              Venue detail
/provenance                 Orders and acquisition history
/locations                  Location management
/collections                Collection management
/collections/[id]           Collection detail
/taxonomy                   Taxonomy family index
/taxonomy/[familySlug]      Items in one taxonomy family
/taxonomy/[familySlug]/[itemSlug]  Works and editions linked to one item
/harmonize                  Library-wide data harmonization; duplicate films, perfumes and paintings merge within their kind
/settings                   Settings: General (defaults for new records)
/settings/display           Settings: lists, sidebar (this browser)
/settings/reader            Settings: reader typography (this browser)
/settings/reading           Settings: reading day, week start, rhythm, goals,
                            timer check
/settings/integrations      Settings: live checks of outside services
/settings/data              Settings: counts, review queues, export, cache
/settings/shortcuts         Settings: keyboard shortcuts
/settings/about             Settings: versions, schema, storage, collections
/perfumes                   Perfumes: the perfume collection's home (open)
/perfumes/new               Add a perfume
/perfumes/[slug]            Perfume detail (slug format: {title}-by-{house});
                            ?formulation={id} chooses one formulation
/films                      Films: the film collection's home (open)
/films/new                  Add a film
/films/[slug]               Film detail (slug format: {title}-by-{director});
                            ?add=version opens "Add version"
/paintings                  Paintings: the painting collection's gallery (open)
/paintings/new              Add a painting
/paintings/[slug]           Painting detail (slug format: {title}-{id})
```

A collection opens when `WORK_DOMAINS[kind].enabled` is true
(`src/lib/catalogue/domains.ts`). Each of its route folders has a `layout.tsx`
that calls `requireEnabledDomain(kind)`, so every page below it (home, and later
detail and new) answers 404 while the collection is unready. Books stay at
`/library`; no book URL changes.

All pages use `force-dynamic` rendering (set once in `src/app/layout.tsx`) — no static generation, no ISR. Every request fetches fresh data from Neon.

---

## Navigation

### Sidebar

Fixed left sidebar (`w-56`, `h-dvh`, `z-40`). Always visible on desktop.

Structure from top to bottom:
1. **Logo**: "Durtal" text
2. **Search trigger**: Button that opens the command palette (`Cmd+K`)
3. **Navigation links**: `NAV_SECTIONS` in `src/lib/navigation.ts`, the one
   list the sidebar and the command palette read. Dashboard, then one entry per
   open collection in the order Books, Perfumes, Films, Paintings
   (`DOMAIN_ORDER`), then Reading, Reader, Authors, Publishers, Organizations, Recommenders, Series,
   Places, Provenance, Locations, Collections, Taxonomy, Harmonize, Settings.
   Icons come from `SECTION_ICONS` and `DOMAIN_ICONS`
   (`src/components/shortcuts/section-icons.ts`).
4. **Timer chip** (SLN-451): the running reading timer, above the footer, in the expanded or the rail layout (docs/03, Reading timer chip). Below `md` it is in the phone bar, between the name and Search. Nothing shows while no timer runs; the reader view has no chip. It loads `getRunningTimer()` after mount, on window focus and when the tab shows again, so a timer started on the phone shows on the desktop when he looks.
5. **Footer**: "catalogue . index . archive" text

Active route is highlighted with `bg-accent-plum`.

### Command Palette

Full-screen overlay activated by `Cmd+K` (or `Ctrl+K` on non-Mac). Uses the `cmdk` library.

Groups:
- One group per open collection (**Books**, **Perfumes**, **Films**, **Paintings**, in `DOMAIN_ORDER`): up to five matches each, by title, series, the names the work is credited to (authors; directors and writers; perfumers and houses; painters) or ISBN. Each opens the work in its own collection (`/library/…`, `/films/…`, `/perfumes/…`, `/paintings/…`) and shows its picture (the active poster, else, for a book, an edition's cover), its makers and year. A book and a film of the same title stay two results
- **People**: matches by any name or other name, with what they are (Writer, Translator or another edition role, Director, Cast, Perfumer, Painter). A person with books opens their author page; anyone else opens their collection's list filtered to them (`/films?director=`, `/perfumes?perfumer=`, `/paintings?painter=`). A person with no credit has no page yet and is left out
- **Organizations**: a publishing profile opens the publisher page; a perfume house or brand opens `/perfumes?house=`; a museum or gallery opens `/paintings?institution=`; any other (a retailer, manufacturer, production company or distributor) opens its page in the organization directory, `/organizations/<slug>`
- **Places**: venues by name or address, archived ones left out
- Pictures: a work's cover or poster, 24x36 like a small card, or a person's portrait, 28px square on the same 36px row; with no picture, the initials on the tint taken from the name, as on the cards. They load lazily in a fixed box, so the list never moves. The search text is normalized to letters and digits (`search_normalize`), so accents never matter, other scripts match as typed, and `%` or `_` match nothing special. Services: `quickSearch` in `src/lib/actions/quick-search.ts`
- **Search**: one "Search books for …" entry per open collection
- **Log progress** (SLN-448), first: when the query is a position ("212", "44%", "+20", "3:12", "p 212") that fits an open reading, one "Log p. 212 · Title" per such reading. When a book found for the query has it as a word of its title ("451", "84", "Catch-22"), the books come first and this group follows them (`queryNamesATitle`). It opens Log progress with what was typed; "+20" stays relative (the server adds it to the row it checks). Services: `paletteReadingItems` in `src/lib/reading/palette.ts`
- **This page**: the page's Edit menu entries ("Edit work", `E W`), Reading menu entries ("Log progress", `R P`) and Copy menu entries
- **Reading**: "Log progress · Title" for each open reading, "Start timer · Title" for each open reading ("Stop timer · Title" while a timer runs; SLN-451), "Start reading..." and "Log a past read..." (the book picker). The open readings load each time the palette opens (`getOpenReadings`), never with the page; every item sends its reading's fingerprint
- **Actions**: one "Add a …" entry per Add menu item, Import books, Keyboard shortcuts
- **Go to**: every `NAV_SECTIONS` entry

Features:
- Real-time fuzzy filtering
- Auto-focus on input
- `Escape` to close
- Glass panel over the veil (`glass`, `glass-veil`; `docs/03_DESIGN_LANGUAGE.md`, Glass)

### Shell

The root `Shell` component wraps all page content:
- Renders the `Sidebar`
- Applies `ml-56` margin to main content (accounts for sidebar width)
- Wraps everything in `ShortcutsProvider` (`src/components/shortcuts/`): Cmd+K → palette (searches books and authors), `/` → list search, `A` → the Add menu (one entry per open collection, then author, publisher, recommender, series, collection, place), `G` → the Go to menu (an open collection's home is `G` then its `keys.go`: Books is `G B`), `Y` → the Copy menu (the page's name, title, ISBN, address and link; pages give theirs with `CopyShortcuts`), `E` → the Edit menu (the page's edit actions, given with `useEditActions`; on the book page `E W` edits the work, `E M` opens the media manager, `E T` edits the taxonomy; on a page with no edit actions `E` does nothing), `R` → the Reading menu (a book page's reading actions, given with `useReadingActions`), `G R` → Reading (`/reading`), ↑ ↓ and Enter → pick in any search list, Enter / Cmd+Enter → confirm or save in dialogs and the Add Book steps (on the Details step both run Fast Track), `?` → the shortcut sheet. The list lives in `src/lib/shortcuts/shortcuts.ts`
- Renders `CommandPalette` and `Toaster` (sonner)
- Wraps the page and the palette in `TimerProvider` (`src/components/reading/timer-provider.tsx`, SLN-451): the one running timer, its ticking time and Start, Pause, Resume and Discard for every page; it also renders `TimerAlerts` (the forgotten-timer question, "A timer is running for Nadja" with "Stop it and start this one", and the discard confirmation)
- Wraps the page and the palette in `ReadingDialogsProvider` (`src/components/reading/reading-dialogs-provider.tsx`), in both branches (the reader view at `/reader/[calibreId]` too): `useReadingDialogs()` opens Start reading, Log progress, Finish, Abandon, Log a past read, Edit and Delete for any book from any page, and the book picker. A dialog loads its book's data when it opens (`getReadingDialogData`) and each dialog's code on first use; a dialog on a reading sends the fingerprint its caller holds, so a reading changed elsewhere gets the server's "This reading changed elsewhere; reload before saving", then the page refreshes

---

## Page Descriptions

### Dashboard (`/`)

The landing page: each open collection, then what is new and curated across them.

**One block per open collection** (Books first): a heading with its icon and
"View all" to its home, its counts and its add actions.
- Books: Books (book works only), Editions, Instances, Authors; Add book,
  Import books.
- Perfumes, Films, Paintings: the record count and the people with the
  collection's first creator role (perfumers, directors, painters); Add perfume,
  film or painting.

**Recent additions**: the 8 newest records across the open collections, newest
first. A book shows as its book card; other records as a `DomainTileCard`.

**Collections**: the first 4 collections in their curated order, with "View all".

**Currently reading** (SLN-448), after the Books block: up to three open readings, reading before paused, as light tiles (cover, title, progress bar, position, a Log button that opens Log progress, and the estimate as server text with a client info button, SLN-451). **Recently finished**: up to four covers with the read's rating and the finish date. Each is left out when empty. Both are one client component with small props (`DashboardReading`, `src/components/reading/reading-tiles.tsx`), and Recent people is too (`RecentPeopleGrid`), so "/" stays within its 300 KB budget. With a goal this year (SLN-455), one line under the tiles: "12 of 30 books this year · on pace" (alone under a "Reading" heading when nothing is being read), redrawn with the browser's reading day.

**Highest rated**, **Recent authors** and **Wanted**: book sections.

---

### Books (`/library`)

The book collection's home, titled "Books". Displays all books with pagination
and search. When more than one collection is open, a switch under the title
(`DomainSwitch`) links to the others and keeps only the search, the filters and
the sort that each home understands (`domainSwitchHref`); the page and page
size start again. The saved view (`durtal-view-mode` cookie) is used only when
the page offers it; any other value shows the grid.

**View modes** (togglable):
- **Grid**: Book cards in a responsive grid (adjustable columns via slider)
- **Mosaic**: The covers alone, in justified rows (`<Mosaic>`, see `docs/03_DESIGN_LANGUAGE.md`, Mosaic). The same view is offered on people, films, perfumes, paintings and collections
- **List**: Compact card list
- **Table**: High-density data table with configurable columns

**Grid size slider**: Adjusts the number of columns in grid view, and the pictures per row in mosaic view (two more than the grid's).

**Column configuration** (table view): Dialog to select which columns are visible.

**Controls**:
- Search (`q`): work title, series, author names, publisher and ISBN
- Sort (`sort`, `order`): Recent, Title, Year, Rating (the book's rating, unrated last), Author (first), Author (last), Last read (SLN-449: the later of the last progress and the last finish, never-read books last), Up Next order (`sort=queue`, SLN-452: the queue position, books not queued last, ties on the id)
- Pagination: 48 items per page by default

**Filters** (the Filters panel; every one is in the URL and read by `parseReadingFilters`, `src/lib/reading/filter-params.ts`, for the page and `GET /api/works`; an unknown value is dropped here and answered 400 by the API):
- Marks (`mark`): Rare, Poison, Favourite; the old `rare=true` still selects Rare
- Reading (`reading`, SLN-449): Unread, Reading, Paused, Read, Abandoned (`readingStateSql`), and In Up Next (`queued`, SLN-452; not a reading state: a queued book can be read or unread); several match any of them
- Holding (`holding`): Owned or Not owned. Owned is a copy that is not deaccessioned (`ownedBookCondition`); both values, or neither, is no holding filter. "Unread I own" is `/library?reading=unread&holding=owned`
- Re-read (`reread=true`): two finished readings or more
- Read in (`readFrom`, `readTo`): a year range on the finish date of a finished reading, at any precision; reversed years are swapped
- Status (`status`): the catalogue status (Accessioned, Wanted, Shortlisted, Tracked, On Order, Deaccessioned), checked against the enum. There is no `status=owned`: Owned is the Holding filter
- Priority (`priority`), Min Rating (`rating`: 5, 4.5+, 4+, 3.5+, 3+; the book's rating), Media (`poster`), Publisher (`publisher`), Location (`location`)

**Bulk selection**: Select multiple works for batch operations (move, tag, delete, change status). "Add to Up Next" (SLN-452) appends the selected books in their page order and says what it skipped: "Added 5 · 2 already in Up Next · 1 being read".

**Empty state**: Displayed when no works match the current filter/search. Provides a link to add the first book.

**Book card** contents:
- Cover image (from S3 thumbnail), with the rare, poison and digital marks only
- Title (serif) and the primary author
- The info row: the status, or while a reading is open `CardReading` in its place ("Reading 44%" with a blue dot, "Paused 44%" with a secondary one; its tooltip is the status's with the reading: "Accessioned · High priority · 2 copies · Reading, 44%"), the language, the rating and the year as the card's width allows. A card carries only `reading: { state, percent }` for an open reading; finished books show nothing more on cards.

**List and table reading** (SLN-449): the list adds a badge after the status ("Reading 44%" blue, "Read" or "Read 3×" sage, "Abandoned" muted); the table offers Reading, Last read, Times read and Progress columns (hidden until chosen in the column dialog; a saved choice gets them hidden too). Both load `getReadingSummaries` only while the list or table shows, so the grid sends nothing more. The table keeps the server's sort until a header is clicked. The timeline view takes the reading and holding filters.

---

### Perfumes (`/perfumes`)

Reachable once perfumes open (see Route Map). `src/app/perfumes/page.tsx` shows
the title, "Add perfume", the collection switch, search (titles and houses), the
sorts (title, release, added, rating), grid and list views (saved:
`durtal-perfumes-view-mode`, `durtal-perfumes-grid-columns`), paging, and the
empty, no-results, loading and error states. An empty catalogue shows "No
perfumes yet" with "Add perfume".

Filters (`PerfumeFilters`, `src/components/perfumes/perfume-filters.tsx`) live
in the URL, so a filtered home is a link. Several values of one key are a comma
list; unknown or malformed values are dropped (`perfumeQueryFromParams`,
`src/lib/catalogue/perfume-params.ts`):

| Parameter | Matches |
|-----------|---------|
| `house`, `perfumer` | Organization or person ids; any one listed. The House list holds every perfume house, brand and manufacturer |
| `houseRole` | With `house`: only that role (`perfume_house`, `brand` or `manufacturer`), shown as the "House role" group in the filters and removed whenever the houses change; without it a house matches in any of the three roles. Alone it filters nothing |
| `family`, `accord`, `note` | Taxonomy item ids; all listed, a broader item takes in its narrower ones |
| `concentration` | Concentrations made (`eau_de_parfum`, `extrait`, ...); any one listed |
| `holding` | `owned` or `not_owned` (both: no filter) |
| `container` | `bottle`, `sample`, `decant` held |
| `favourite` | `1`: favourites only |
| `from`, `to` | Release years (negative for BC); reversed years swap |

A card (`PerfumeCard`) shows the bottle contained in a square frame over its
own tone (or a flacon drawn from the title), the title on two fixed lines, the
house, and the release year with the concentrations ("1925 · EDP · Extrait").
Chips mark a favourite and the count held. The grid takes its cards per row from
the size slider, inside an `@container`: a narrow page holds fewer
(`COL_CLASSES`, `src/components/domains/domain-home-shell.tsx`), two on a phone.
A list row (`PerfumeRow`) shows a small bottle, title, house and facts, and what
is held (under the facts on a phone).

### Perfume detail (`/perfumes/[slug]`)

The hero has the bottle image (the chosen formulation's image, else the
perfume's) and, beside the title, the favourite toggle and the action menu
(Edit, Images, Delete) on the title's cap-height center. Under it: the house
(a link to the home filtered by house), perfumers (links filtered by perfumer),
creative direction, launch and discontinuation dates, manufacturer,
concentrations, what is in the collection and the personal rating.

Sections, in order: description (`Prose`); Notes (the pyramid: top, heart,
base, then "Other"; edited in place); Families and accords; Formulations (each
concentration as sold, with its own dates, perfumers, notes, families, accords
and image; `?formulation=` chooses one and the facts and notes above show its
own values); Bottles and samples (formulation, size, what is left, status,
storage place, acquisition); Wanted (see below); Retailers (listings with
recorded prices);
Gallery; Sources (cited sources, and sources a reader adds); Your notes;
related perfumes ("More from {house}", "More by {perfumer}", "Shared notes").

Create and edit share `PerfumeForm`: title, houses (house, brand, manufacturer),
people (perfumer, creative director, with "Unknown"), launch and
discontinuation dates of any precision, description, and (on create) notes by
position, families and accords. Dialogs add and edit formulations, bottles and
samples, retailer listings and prices, and sources. A perfume with bottles,
samples or listings cannot be deleted; the dialog says what to do first. The page ends with its history and comments (`ActivityTimeline`, reloaded after every save): creation, a new title, each credit, organization and classification item added or removed, and each bottle, sample or decant added, changed (status, amount left, condition, location) or removed.
Keyboard: `⌘Enter` saves the form or dialog in front; arrow keys and Enter pick
in the house, people and note pickers; Escape closes a dialog.

### Films (`/films`)

Open since SLN-367. `src/app/films/page.tsx` shows the title, "Add film", the
collection switch, search (titles and original titles), the sorts (title,
release, runtime, added, rating), grid and list views (saved:
`durtal-films-view-mode`, `durtal-films-grid-columns`), paging, and the empty,
no-results, loading and error states. An empty catalogue shows "No films yet"
with "Add film".

Filters (`FilmFilters`, `src/components/films/film-filters.tsx`) live in the
URL. Several values of one key are a comma list; unknown or malformed values
are dropped (`filmQueryFromParams`, `src/lib/catalogue/film-params.ts`):

| Parameter | Matches |
|-----------|---------|
| `director`, `cast` | Person ids; any one listed in that role. A director and a cast member must both match |
| `genre` | Film genre ids; all listed, a broader genre takes in its narrower ones |
| `language`, `country` | Original language or production country ids; any one listed |
| `holding` | `owned` or `not_owned` (both: no filter) |
| `medium` | `physical`, `digital` copies held |
| `favourite` | `1`: favourites only |
| `from`, `to` | Release years; reversed years swap; an unknown date never matches |

A card (`FilmCard`) shows the poster in a 2:3 frame, cropped as framed, over its
own tone (or a title card drawn from the title and year, `TitleCard`,
`src/components/shared/no-photo.tsx`), the title on two fixed lines, the
directors, and "1982 · 1h 49m · US". Chips mark a favourite and the copies held.
A list row (`FilmRow`) shows a small poster, title, directors and facts, and
the copies held (under the facts on a phone).

### Film detail (`/films/[slug]`)

The active still (a `background` image) lies behind the header, dimmed, as on a
book page. The header has the poster (or the title card), the title with the
favourite toggle and the action menu (Edit, Images, Delete) on its cap-height
center, the original title, and: directed by (links to `/films?director=`),
written by, starring (the first three, links to `/films?cast=`), released,
runtime (per version when they differ), the copies in the collection and the
personal rating.

`DetailColumns`: the reading column holds the synopsis (`Prose`), Cast (billing
order, characters, credited names; the first twelve until "Show all"), Crew by
role, Linked works, Versions (each cut with its runtime and releases: territory,
format, date, distributor), Copies, Wanted (see below), Sources and Your notes. The record column holds
Details (original title, first release, countries, languages, production,
added), Genres (edited in place) and Media counts. Then the gallery and related
films ("More by {director}", "Shared cast", "Shared genres").

Create and edit share `FilmForm`: title, original title, cast and crew in three
groups (direction and writing, cast, crew; each with roles, characters,
credited names, "Unknown" and reordering), first release of any precision,
countries, languages, production companies, genres and synopsis. On create, a
film already in the catalogue under the same title or original title is shown:
a remake is a new film, and a cut goes to that film as a version ("Add a version
to it" opens `?add=version`). Dialogs add and edit versions with their
releases, and copies (physical or digital, version and release, status,
storage, acquisition, disposal). A version a copy names, and a film with
copies, cannot be deleted; the dialog says what to do first. The page ends with its history and comments (`ActivityTimeline`, reloaded after every save): creation, a new title, each credit, organization and classification item added or removed.

### Paintings (`/paintings`)

Built in SLN-368; reachable once the collection opens (see Route Map).
`src/app/paintings/page.tsx` shows the title, "Add painting", the collection
switch, search, the sorts (title, date, added, rating), grid and list views
(saved: `durtal-paintings-view-mode`, `durtal-paintings-grid-columns`), paging,
and the empty, no-results, loading and error states. An empty catalogue shows
"No paintings yet" with "Add painting".

Filters (`PaintingFilters`, `src/components/paintings/painting-filters.tsx`) live
in the URL, with the same rules as the other homes (`paintingQueryFromParams`,
`src/lib/catalogue/painting-params.ts`):

| Parameter | Matches |
|-----------|---------|
| `painter` | Person ids; any one listed, as painter of the work or attributed hand of an object |
| `movement` | Art movement ids; any one listed |
| `genre`, `technique`, `medium`, `support` | Painting family item ids; all listed, on the work or an object, a broader item takes in its narrower ones |
| `institution` | Organization ids; any object owned by one listed |
| `venue` | Venue ids; any object whose confirmed current location is one listed |
| `holding` | `owned` or `not_owned`: objects you own that are not disposed (both: no filter) |
| `favourite` | `1`: favourites only |
| `from`, `to` | Years the creation period overlaps; reversed years swap; an unknown date never matches |

A card (`PaintingCard`) shows the whole picture in a fixed 4:5 frame, contained
and never cropped, over its own tone (or a title card, `TitleCard`), so every
card of a grid has one height; then the title on two fixed lines, the painters,
and "1889 · Museum of Modern Art". Chips mark a favourite and the objects you own.

### Painting detail (`/paintings/[slug]`)

The header puts the picture beside the identity (stacked on a phone). The
picture takes its own proportions (the image's, else the original's size),
about half the page wide and never taller than 78% of the window, contained,
never cropped. Beside it: the title with the favourite toggle and the action
menu (Edit, Images, Delete) on its cap-height center, painted by (with the
attribution, links to `/paintings?painter=`), date, movements (links), the
original's owner, where the original is now (venue link, custody, display,
since when, and how long ago it was checked; past a year: "check again"), what
you own of it and the personal rating.

`DetailColumns`: the reading column holds the description (`Prose`), the
original and its versions, reproductions, Wanted (see below), Sources and Your
notes. Each object
lists its size, date and own attribution, its owner (institution with
collection and accession number, a private collection, you, or unknown), what
you hold, where it is now, and its location history (newest first; probable and
uncertain claims with their certainty, and a claim that contradicts the current
location is marked). The record column holds Details (date, size of the
original, added), Classification (edited in place) and Media counts.

`PaintingForm` creates and edits the identity: title, painters with their
attribution ("Unknown" for an unnamed hand), date of any precision, movements,
genres, techniques, media, supports and description. `ArtObjectDialog` adds and
edits an original, a version or a reproduction (which may name the original it
reproduces), with size, its own attribution, and the owner; an object you own
adds status, storage, acquisition and disposal. `WhereaboutsDialog` records a
move, a loan (an exhibition, on display), a return to the owning venue, a past
or uncertain location, or edits a record; places are a venue, a private place,
unknown, lost or destroyed. A move closes the current location on its date.
"Checked today" stamps the record. A painting with objects you own cannot be
deleted; the dialog says what to do first. The page ends with its history and comments (`ActivityTimeline`, reloaded after every save): creation, a new title, each credit, organization and classification item added or removed, and each location recorded ("Moved from Louvre, Paris to Tokyo Gallery (on loan for an exhibition, confirmed)").

### Linked works (every detail page)

`LinkedWorksSection` (`src/components/catalogue/work-relations.tsx`) lists the
links someone recorded between the work and others, grouped by how they read
from this work ("Adapted from", "Remade as", "Flankers", "Inspired by"): the
other work's title (a link to its page), its collection and creators, the cited
source and notes, and Remove (the source stays). It sits on film pages after
Crew, perfume pages before the gallery and painting pages before Sources, with
"Link a work"; a book page shows it after Editions only when a link exists,
and its actions menu holds "Link a Work". These are facts with sources; the
related rows at the foot of a page only suggest, and stay apart.

The dialog (`WorkRelationDialog`) offers the links this work can take, both
ways ("Adapted from a book", "Adapted as a film", "Inspired by another work"),
a title search in the kinds that fit, and a source of the work the link starts
from: one it already has, or a new name and address recorded with the link. An
inspiration must cite one.

### Work Detail (`/library/[slug]`)

The detail page for a single work. Displays the work and all its editions and instances.

**Work header**:
- Poster image (from media, type `poster`)
- Canonical title (serif, large)
- Primary author(s) with role labels
- Original year and language
- Rating (0.5 to 5 in half steps: the stars and the number)
- Catalogue status badge
- Series name and position (if applicable)

**Description**: Synopsis text. Falls back to work description if no edition-specific description exists.

**Subjects**: Work-level thematic pills (e.g., "Existentialism", "Postcolonialism").

**Work media section**: Upload and gallery for work-level images (poster, background, gallery).

**Editions panel**: One card per edition. Each edition card shows:
- Cover image (left), metadata (right)
- Title (if different from work title, e.g., translated title)
- Publisher, imprint, publication year, language
- ISBN-13, page count, binding, dimensions
- Edition-specific contributors: "Translated by X", "Edited by Y", "Introduction by Z"
- Genre and tag pills
- Edition flags: first edition, limited edition
- Metadata provenance: source and "last fetched" timestamp

**Instances panel** (nested under each edition):
- Per instance row: location, sub-location, format, condition
- Collector details: signed, first printing, dust jacket, inscription
- Acquisition info: type, date, source, price
- Lent-out indicator with borrower name and date
- Quick actions: move, update condition, mark as lent, remove

**Actions**: Edit work metadata, add edition, add instance, re-fetch metadata, manage collections, delete work.

**Edit menu** (`E`): `E W` edits the work, `E M` opens the media manager, `E T` edits the taxonomy. The actions menu shows these keys. Plain `E` and `T` open no dialog.

**Reading** (SLN-447):
- *Header control*: under the title, one button whose label is the book's reading state ("Start reading", "Reading · p. 212 of 480 · 44%", "Paused at 44%", "Read · 14 Apr 2024", "Read 3 times · 2024", "Abandoned at p. 120"), with a menu of the actions that make sense now (start, log progress, pause or resume, finish, abandon, edit, re-read, resume an abandoned read, start again, log a past read), each with its `R` key. The Read button for digital editions follows it.
- *Reading section*, after Notes: the current reading (edition, copy and where it is, a progress bar, the position, its estimate "About 6 h 40 min left · Around 18 Oct" with an info button that says what it is based on, "Started 2 Oct in Amsterdam · last read yesterday", the chapter, Log progress, Start timer or "Stop timer 12:04", Pause or Resume, Finish, and a menu with Add a session, Abandon, Edit and Delete), its **Sessions** list, then one row per earlier read, newest first (its number among all reads, dates, outcome, format, the edition when it changed, the read's rating, the review's first lines), and "Your ratings: 4 (2012), 5 (2024)" with two rated reads or more. With no readings the section is left out and "Start reading" and "Log a past read" are in the actions menu.
- *Quotes and notes* (SLN-453, `src/components/reading/notes-section.tsx`), after the Reading section and only when the book has some; the book's own "Notes" section above is the work's notes and stays as it is. `SectionHeading` "Quotes and notes" with the count and "Add a quote". By page, then the order added. Each item: the passage in `Prose` with its line breaks (a quote with a rule at its left), his thought, then one line "Note · p. 212 · ch. 7 · 2nd read" with the star and a menu (Edit, Copy, Delete with a 10-second Undo). Copy puts `formatNoteForCopy`'s text on the clipboard: the passage in double quotes, a new line, "André Breton, Nadja, p. 212".
- *Record group* "Reading": first read, last finished, times read (finished reads) and time spent once sessions have durations.
- *Dialogs* (loaded when opened): Start reading ("I'm at", remembered per device; edition and copy with the smart default; format; pages to read with "Find page count"; audio length; start date, exact or not; already at), Log progress (one field, or Page / % / Time with keypad fields on touch; quick steps; another edition or format; a move back asks "Fix my last log" or "I went back"; the last page opens Finish), Finish (date, rating, the book's rating, review; then the series' next volume), Abandon, Log a past read (dates at any precision), Edit reading, Delete (it says "Its 2 quotes and 1 note stay with the book" when it has any), and the note dialog. Log progress, Finish, Abandon and Delete have a 10-second Undo. `?then=start` opens Start reading on arrival (Log progress when the book is being read) and `?then=past` opens Log a past read, once: `ReadingThen` (`src/components/reading/reading-then.tsx`) opens the dialog through `useReadingDialogs()`, then takes `then` out of the address with `router.replace`, so a refresh or Back does not open it again. The Finish dialog's next volume and the add-a-book page link here.

- *Sessions* (SLN-451, `src/components/reading/session-list.tsx`): a disclosure under the current reading, "12 sessions · 9 h 40 min", with Add a session. It loads the sessions when opened (`getReadingSessions`), newest first in the session order. A row: the date; the time in the session's own zone, with the zone's city when it differs from the browser's ("21:30 Mexico City"); the duration; the pages; the pace ("36 p. an hour"); the edition or format when it differs from the reading's; and a source icon (Logged by hand, Timed, From the e-book reader, Imported). The running timer is the top row, "Running · 12 min", with no menu. Each other row has Edit and Delete, each with a 10-second Undo. Earlier reads show their totals and the same list, collapsed.
- *Add a session* and *Edit session*: date, optional start time, time read (hours and minutes), where it ended (one field, or Page / % / Time keypad fields on touch), the edition or format, a note. The start is shown, not asked: "From p. 180, where the session before ended". An end below it says "This session ends before the one before it (p. 212); it adds no pages".

**Reading menu** (`R`, on a book page): `R S` starts (or re-reads), `R P` logs progress, `R U` pauses or resumes, `R F` finishes, `R A` abandons, `R T` starts or stops the timer, `R N` adds the book to Up Next or takes it off, `R Q` adds a quote (on the open reading), `R L` logs a past read, `R H` goes to the Reading section. It never opens while a dialog is open. The command palette lists the same actions under "This page".

**External links**: Open Library, Google Books, Calibre-Web (if digital instance with calibre_url exists).

---

### Add Book (`/library/new`)

Multi-step wizard that creates a work + edition + instance(s) in one pass.

**Step 1 — Search/Identify**:
- ISBN input (primary) or title/author search (secondary)
- Queries Google Books and Open Library in parallel
- Displays candidate results for selection
- Option: "Manual entry" to skip search

**Step 2 — Work Confirmation**:
- If a matching work already exists (by ISBN or title+author): prompt "Add a new edition to existing work [title]?" or "Create as new work?"
- Prevents duplicate work creation

**Step 3 — Edition Metadata Preview**:
- Auto-populated fields shown in editable form
- All `editions` table fields are exposed
- Contributors (translator, editor, etc.) added here
- `metadata_locked` flag available to prevent future auto-fetch

**Step 4 — Instance Creation**:
- Location assignment: select one or more locations
- For each location: format, condition, acquisition details, collector flags
- Multiple instances can be created at once (e.g., hardcover in Amsterdam + EPUB in Calibre)

**Step 5 — Categorization** (optional):
- Subjects (work-level)
- Genres (edition-level)
- Tags
- Collection assignment

**Step 6 — Confirm**:
- Summary of everything about to be created
- Single "Add to catalogue" action

**From the reading book picker** (SLN-448): `?q=` (trimmed, at most 200 characters) or `?isbn=` (an ISBN-10 or ISBN-13; anything else is ignored) fills the search and runs it; an ISBN also fills the ISBN field, as an ISBN-13. `&then=start` or `&then=past` sends both ways out to a book page (a new book, or an edition added to a book) with `?then=`, so the new book opens with Start reading or Log a past read. `bookPickerAddHref` (`src/lib/reading/book-picker.ts`) builds the link; `addBookParams` reads it.

**Fast Track and leaving** (SLN-320, SLN-437, SLN-438):
- The Details step (title, author, status) has Fast Track: it saves the work and one edition at once, without copies or categorization. Enter in a one-line field runs it, and the title takes the focus when the step opens, so a search result picked with Enter is one more Enter from saved. Enter still adds a line in the description and picks in open lists. When Fast Track is not shown (an edition for an existing work), Enter goes to the next step.
- Every step, the duplicate prompt included, has a Cancel. It goes back to the page before, or to `/library` when the wizard was opened directly, and saves nothing (nothing is written before Fast Track or "Add to catalogue").

---

### Bulk Import (`/library/import`)

Interface for importing books in bulk from external sources. Reading history (Goodreads, StoryGraph, the seed spreadsheet) is imported at `/reading/import`; a line under the header links there.

**Supported sources**:
- Calibre library export
- Custom CSV

**Interface**:
- Drag-and-drop upload zone
- Processing pipeline visualization (bronze -> silver -> gold)
- Preview of parsed records before committing
- Conflict resolution: skip, overwrite, merge
- Progress indicator with per-record status

**Info cards** displayed:
- CSV Import guide
- Python ingestion scripts reference
- Import history

---

### Identify Editions (`/library/identify`)

The old import created one edition per book with no ISBN, publisher or cover (metadata source `phantom_canon`). This page shows them one at a time: books with copies first, then by catalogue status. `?edition=<id>` starts at one edition; the "Identify" link next to the "Edition not identified" badge on the book page uses it. The library header links here.

**Per book**:
- Poster, authors, status, copies and their locations, collections, and the house the placeholder already links to (often set by hand).
- **Your editions of this book**: identified editions the book already has. "Use this edition" (with a confirm step) moves the placeholder's copies and collection memberships there and removes the empty placeholder.
- **Editions on ISBNdb**: the best 3 of up to 50 results for "title author" (more on demand), with cover, publisher, year, format, pages, language, ISBN and notes ("Another language", "Not Vintage", "E-book"). The search box takes other words or an ISBN. "Pick" saves at once; the message that follows has Undo.
- Skip (to the end of the list), "No ISBN: keep it as it is" (with Undo), "Other sources" (Match with Google Books and Open Library), "Open the book".

---

### People (`/people`)

Everyone in the catalogue, in every collection: writers, translators, directors, actors, perfumers, painters (SLN-419). Every old `/authors` and `/authors/[slug]` URL redirects permanently (308) to the matching `/people` URL; slugs did not change. The REST API keeps `/api/authors`.

**Views**: grid, list, map and timeline (the map and timeline show book people, who carry places and dates).

**Filters**: Collection (the collections a person belongs to, `person_domains`) and Role (any credited role, such as "Films: Director" or "Books: Translator"; each choice shows how many people hold it), plus nationality, gender, zodiac sign, status and birth and death years. Search, sort and pagination as before.

---

### Person Detail (`/people/[slug]`)

**Header**: optional portrait, name, nationality, birth and death years.

**Record**: a Credits group sums up each collection's roles ("Books: Author 12, Translator 3", "Films: Director 2"), then details and links.

**Books**: works written, as book cards, and edition contributions (translator, editor, illustrator…). A person with no books has neither section.

**Films, Perfumes, Paintings**: each collection the person is credited in lists its works, linked, with the person's roles.

**External links**: Website, Open Library, Goodreads.

---

**Reading** (SLN-449): the Books heading says "Read 7 of 12" (a book read at least once, one being re-read included); All, Unread, Reading (or paused) and Read over the books (`?reading=`); the record's Reading group: read, re-read books, your average (the books' own ratings) and the last read. Cards show an open reading.

### Publishers (`/publishers`)

- Grid, list and detailed views; each card leads with the house's logo, whole on a dark tile (the first letter when there is none), then its name, kind, country and edition count.

### Publisher Detail (`/publishers/[slug]`)

- Header like the author page: the house's background banner and backdrop, its logo (shown whole, never cropped), the name, what it is (imprint of, group) and where, when and where it was founded ("Founded 1936 in New York"), the favourite star, Edit and an actions menu (Copy name, Edit, Manage media, View in library). Manage media opens the shared media manager with a Logo and a Background tab (owner `organization`).
- Reading column: About (`<Prose>`), notes, then the books as a catalogue: one card per book with this house's edition cover (owned edition first, then one with a cover, then the earliest), in grid or list view. The view is in the URL (`?view=grid` or `?view=list`), so a shared link opens the same view; without it, the last view chosen on this device. The house's imprints count as the house.
- Search, filters (status: owned, wanted, on order; marks: Rare, Anathema, Favourite; imprint; language; publication years as a range; binding; author), sort (title, author, year, recent) and pagination run on the server (`src/lib/publishers/books.ts`) and live in the URL. The old `?filter=` tab links still open the same view.
- Record column: the counts (books, editions, owned, wanted, on order), details (country, founded, founded in, group, imprints, other names, specialties, ISBN prefixes) and the website.
- Below: books wanted from this house (acquisition targets not yet received). Loading skeleton, an empty state for a house with no books, and a not-found page.
- The record's Links group opens the house's organization page, where its roles in the other collections show.

**Reading** (SLN-449): "Read" in the "In the catalogue" group counts the house's books read at least once; the cards show an open reading.

### Organizations (`/organizations`)

One directory for the organizations of every collection: publishing groups, publishers and imprints, perfume houses, brands and manufacturers, retailers, production companies and distributors, museums and galleries. A publisher and its organization are one record (`publishing_houses`); the directory adds no table.

- Search by name or other name (accent-insensitive, typo-tolerant, ranked), in the URL as `q`.
- Role filter: one role at a time (`role`), each chip with the number of organizations that hold it among those the search finds; roles nobody holds are left out. Publishing levels come from the publisher record, the other roles from `organization_roles`.
- Each row: the name, its roles in the collections' own words ("Perfume house", "Distributor", "Museum") and country, and what it takes part in ("124 editions · 2 houses under it · 1 book wanted · 3 films · 4 copies supplied"). Row counts stop at 999+ (`COUNT_CAP`), so a page reads a bounded number of rows per organization.
- Pagination like the other lists. "Add organization" opens a dialog for any role outside publishing; publishers are still added under Publishers.
- Services: `getOrganizationDirectory` and `getOrganizationRoleCounts` in `src/lib/actions/organization-directory.ts`.

### Organization Detail (`/organizations/[slug]`)

- Header: the name, its roles, and an actions menu (Edit, Delete) on the name's cap-height center.
- One part per collection it takes part in, each left out when empty:
  - **Books**: its publisher profile (level; editions and books counted, with the houses under it when it has some; the house above it and the houses under it) and a link to the publisher page, which keeps the books.
  - **Perfumes**: a row of cards per role (as perfume house, as brand, as manufacturer), the perfumes it sells (retailer listings), and how many of your bottles it supplied.
  - **Films**: films it produced and films it distributed, and how many of your copies it supplied.
  - **Paintings**: paintings it owns (as a museum or gallery) and paintings at its venues now.
  - **Venues**: the venues it runs or owns, each linking to its place page.
- Each row shows the first 24 works with the full count; titles link to the collection's filtered home where one exists (`/perfumes?house=…&houseRole=…` lists only that role, `/paintings?institution=`, `/paintings?venue=`).
- Record column: roles, country, other names, the publisher page and the website.
- Edit changes the name, other names, country (its country id follows the text, as on the publisher form), website, description and the roles outside publishing (`updateOrganizationProfile`); the book profile and the house above it stay as the publisher page sets them. A role that perfume or film records still use cannot be removed (the database says why), and an organization that owns paintings stays a museum or a gallery.
- Delete lists what still links to the organization (editions, houses under it, books wanted from it, perfume and film links, copies supplied, paintings, venues) and stays off until nothing does (`removeOrganization`).
- An address that is malformed or longer than 500 characters shows the not-found page.
- An organization nothing links to shows one line saying how it gets linked. Loading skeleton and a not-found page.

### Series (`/series`)

Index of all book series in the library.

**Features**: Paginated list. Sort by relevance, title, book count or recent. A link opens `/series/suggestions` when some books match a series by title.

---

### Series Detail (`/series/[id]`)

Single series view.

**Header**: Series title, original title, description, completion indicator.

**Works list**: Ordered by `series_position`. Each entry shows cover thumbnail, title, authors, position number.

---

**Reading** (SLN-449): "Read 4 of 20" beside "owned"; "Next to read: 5. L'Assommoir · On your shelf in Amsterdam, Study, shelf 3" from `nextToRead` (the first volume not finished after the last finished one) and the copy (an available physical copy, else an available digital one, else any copy still held, through `copyWhereabouts`; with none, "Not owned · Wanted"); each volume's reading badge. The series cards add "· 4 read".

### Recommender Detail (`/recommenders/[id]`)

The books one person or source recommended, as book cards (an open reading on each), with "You have read 7 of their 15 picks" in the header when any is read (SLN-449).

### Locations (`/locations`)

Management interface for physical and digital storage locations.

**Per location**:
- Name
- Type badge (physical / digital)
- Sub-locations displayed as badges
- Instance count
- Address details (if physical)

**Actions**: Create location, edit, delete. Create sub-location. Three input modes for address entry:
- Manual form (street, city, region, country, postal code)
- Postal code lookup (via Nominatim geocoder)
- Interactive map picker (Leaflet with Carto Dark Matter tiles)

---

### Collections (`/collections`)

Grid of curated collections. A collection holds book editions and whole works
of every open collection: books with no edition chosen, films, perfumes and
paintings (SLN-362).

**Per collection card**: Name, description, count ("12 editions" when it holds
only editions, else "5 items", a book held both ways counted once), cover
image or the first four members' images.

**Collection page** (`/collections/[id]`): one ordered list of member cards
(`MemberCard`): an edition (cover, publisher and year, ISBN; "also collected
as the book" when the whole book is in too), a whole book ("The book, no
edition chosen"), a film (poster or title card, directors, year and runtime),
a perfume (bottle, house, concentrations) or a painting (picture, painters,
date). Each card moves earlier or later in the one order and can be removed;
the header counts books, editions, films, perfumes and paintings.

**Management**: Create, edit, delete collections. "Add" opens a dialog with
Editions, Books, Films, Perfumes and Paintings (the open collections). The
library's selection dialog adds a book with no edition as a whole book; film,
perfume and painting pages have "Collections" in their actions menu.

---

**Reading on a collection page** (SLN-449): "· 12 of 30 books read" after the counts, and each book's reading state on its card's note line.

### Reading (`/reading`)

The reading hub (SLN-448). `PageHeader` "Reading" with "Log a past read" and "Start a book" (both open the book picker), a "Goals" menu (SLN-455: "Set a reading goal", and "Set a reading rhythm" or "Change the reading rhythm", which opens `/settings/reading` at that field), and `ReadingTabs`.
- **Currently reading**: one card per reading in status reading, most recently read first (last read, then started): cover, title, author, progress bar, "p. 212 of 480 · 44% · last read yesterday" ("yesterday" counts reading days), the estimate with its info button (SLN-451), Log progress, Start timer or Stop timer, and a menu (Pause, Finish, Abandon, Add a quote, Open book). One column at 390 px, two from `md`, three from `lg`; the cards share one height (`CardHeading`).
- **Goals this year** (SLN-455), when a goal exists: one card per metric (books, pages, hours) with its count, a sage bar, one neutral line ("On pace", "2 books ahead", "18 to go: about one every 2 weeks from now", "Goal reached on 14 Oct") and an info button; "Edit goals" opens the goal dialog.
- **This week** (SLN-455), when the rhythm is set: this week's seven days in the order of the week start (a filled mark on a reading day, today marked), "4 of 5 days this week", then the 12 weeks before as bars, "kept 9 of the last 12 weeks". A reading day has an ended session (by `read_on`) or a finish at day precision; the running timer never counts. No streak.
- Goals and the rhythm render with the server's reading day, then the browser's; when the browser's reading year differs (late on 31 December in Mexico City) the cards load that year's goals.
- **The goal dialog** (`GoalDialogButton`, `src/components/reading/goal-dialog-button.tsx`, the one trigger; the hub menu, Settings and the stats page): this year or next, a target for books, pages and hours (empty means no goal), "Count re-reads", the work types to leave out, and the past years ("28 of 30 books in 2025").
- **Up next** (SLN-452): the first five covers of Up Next, each with Start (the Start dialog with the queued edition), and View all.
- **Passage of the day** (SLN-453): one of his quotes in `Prose`, with its book (a link), author and page, and "Another" when there are two or more. Hidden with no quotes. The day is the server's reading day (`readingDay(new Date(), appTimeZone(), dayStartHour)`), so the passage is the same all day on every device; `choosePassage` (`src/lib/reading/passage.ts`) takes his favourite quotes when there are at least 30, else all his quotes with the favourites first, each group in the order of the SHA-256 of its id, and picks (days since 1970-01-01) modulo their number. "Another" steps to the next one in that order in the browser only. A passage over 600 characters opens clamped to 8 lines with "Show all".
- **Paused**: one line each with "paused 3 weeks ago" and Resume.
- **Recently finished**: the last six finished reads: cover, title, the read's rating, the finish date at its precision.
- **On this day** (SLN-456), one line above the sections: the books finished or started on this calendar day in earlier years, at day precision only, at most three, "On this day in 2019 you finished Nadja (4.5); in 2017 you started Watt." with the read's rating. The server sends the matches for its reading day and one day on each side (`onThisDay`); the line shows the browser's reading day. In January it adds "Your 2025 in review", a link to the year just ended when that year has finished books. Hidden otherwise.
- With no reading at all: `EmptyState` with Start a book and "Import from Goodreads or StoryGraph" (a link to `/reading/import`). A later step adds suggestions here.

**Book picker** (`src/components/reading/book-picker.tsx`): opened by "Start a book", "Log a past read", "Add a quote" (SLN-453: the note dialog, on the book's open reading) and the palette. Books only, matched without accents on title and authors as you type, owned books first (`ownedBookCondition`), then by title, at most 20 (`searchBooksToRead`). Each row: cover, title, author, "Owned" or the catalogue status, and the reading state ("Reading 44%", "Paused", "Read 2 times"). Choosing a book opens the dialog the picker was opened for; Start on a book being read opens Log progress instead. The empty result and the footer read 'Not in Durtal? Add "<query>"', a link to `/library/new?q=<query>&then=start` (`?isbn=` for an ISBN, `&then=past` for a past read, `&then=quote` for a quote).

**Tabs**: `ReadingTabs` (`src/components/reading/reading-tabs.tsx`) is the one tab row of every reading page, in its final order: Now (`/reading`), Up next (`/reading/next`), Journal (`/reading/journal`), Notes (`/reading/notes`), Stats, Suggestions, Import. A tab shows only once its page exists; Now, Up next, Journal, Notes, Stats and Import show today. Now is current on `/reading` only; any other tab on its path and below, and Stats also on `/reading/year` and below (the tab's `also`). The e-book reader's pages have no tab row.

### Up Next (`/reading/next`)

The books he wants to read next, in his order (SLN-452), from `getQueue` (one query for the whole list) and the pure `src/lib/reading/queue.ts`.
- A summary: "14 books · about 96 hours at your pace · 2 without a length". Time to read is a print or e-book's pages at his pages an hour for its language and format (`getPaceContext([])`'s prior), or an audio edition's last known length. With no timed session yet it shows pages only: "14 books · 4,210 pages".
- Rows: position, cover, title and author, pages (or audio length), where the copy is (`copyWhereabouts` of the copy at hand at the remembered home, else the first copy held, else "Not owned"; a lent copy reads "Lent to M. since 3 May"), time to read, the note, the added date and the reading history ("Read in 2012"). Start reading opens the Start dialog with the queued edition (else the default one); the row menu has Move to top, Move up, Move down and Remove from Up Next (10-second Undo).
- Reordering with `@dnd-kit/sortable`: drag a row by its handle (44 px on touch), or focus the handle and press Space, the arrows and Space. Each move saves at once and a live region says "Nadja moved to position 2 of 14". A refused move puts the row back.
- "At hand in Amsterdam" (`?hand=1`) shows only the books with a copy at hand at the "I'm at" home (an available copy there or at a digital location), in the same order. With no home remembered it offers the "I'm at" select. Under the filter each row shows its place in all of Up Next ("2", "5", "9"), and Move to top puts the book above every other book.
- 50 books at a time: "Show 50 more" (`?show=100`, keeping `hand=1`) adds the next ones; the summary counts every book. A list of 412 books stays within the page budget.
- Empty: "Nothing in Up Next" with "Add from your library" (`/library?reading=unread&holding=owned`).

**Up Next elsewhere**: the book page's reading control (unread and read books) and actions menu ("Add to Up Next", or "In Up Next, 3rd · Remove"), the R menu key **N**, the library's bulk toolbar, the hub's strip, the palette ("Go to Up next"; "Add to Up Next" under "This page" on a book page). Starting a book takes it off Up Next: "Started Nadja · removed from Up Next".

### Notes (`/reading/notes`)

The commonplace book (SLN-453): every quote and note, from `parseNotesQuery` (`src/lib/reading/notes-params.ts`, bad values dropped; the filtered export of a later step reads the same parameters) and `searchNotes`. `PageHeader` "Reading" with "Add a quote" (the book picker, then the note dialog) and `ReadingTabs`.
- The search (`q`) runs on `reading_notes.search_text` with `textSearchCondition`: "melancolie" finds "mélancolie", and a one-letter typo in a word of four letters or more still finds the passage. A search lists the best match first ("Best match", `sort=relevance`) unless he chose a sort.
- Filters in the URL: Kind (`kind=quote|note`), Favourites only (`fav=1`), Book (`book`, a work id), Author (`author`), Year added (`year`, in the app's zone). Sorts (`sort`, `order`): Newest (`newest`, the default) and Book and page (`book`: by title, then each book's pages, grouped under the book's title and author). 48 per page (`page`), or the size saved with the page's size control (`perPage`).
- A summary: "312 quotes and notes", or "12 of 312" when filtered. The list is drawn in the browser from slim rows (`NotesList`), so a note is sent once. Each item: the passage in `Prose` (a quote with a rule at its left), his thought, then "Nadja · André Breton · p. 212 · 2nd read" with the title linking to the book, the star and the menu (Edit, Copy, Delete).
- Empty: "No quotes yet" with "Add a quote". No match: the usual "No quotes or notes match" with Clear.
- A passage over 600 characters opens at 8 lines with "Show all", here and on the book page.

**Quotes elsewhere**: the note dialog (`src/components/reading/dialogs/note-dialog.tsx`, loaded when opened) is opened by the book page's section, its R menu key **Q**, the Log progress dialog's "Add a quote" (at the page typed there; closing the note dialog goes back to Log progress with what was typed), the hub's current reading cards, and the palette ("Add a quote · Nadja" per open reading, "Add a quote..." for any book, "Go to Notes"). It has Quote or Note, the passage (a large text area with its label; a pasted word broken over two lines joins up, `joinHyphenatedLines`), page (or percent for a reading counted in percent or time), chapter, the reading (by its number, the open one by default), a Favourite switch, and for a quote "Your thought" in `TiptapEditor`, loaded with the dialog's first quote. Cmd+Enter (Ctrl+Enter) saves from the text area; Enter saves from the page. On a touch screen every control is at least 44 px, the page field opens the number pad, and the empty text area says "To copy a printed page, tap and hold here, then Scan Text." (iOS Live Text reads the page into the field; no OCR library).

### Stats (`/reading/stats`)

A year's reading, or all time (SLN-456), from `src/lib/reading/stats.ts`: a handful of aggregate queries per section, never one per book, computed per request and never cached. `PageHeader` "Reading" with "Set a reading goal" (`GoalDialogButton`) and "Year in review" (`/reading/year/<year>` when the year has finished books, else `/reading/year`), then `ReadingTabs`.
- **The year**: a row of chips under the tabs, "All time" then each year with readings, newest first (a finish, a stop, a start or a session with a known date). `?year=2025`, `?year=all`; no parameter, or a year without readings, or anything else, is the year of the current reading day.
- **Sections**, in this order, each a `SectionHeading`, each left out without data: the year in numbers (books finished, pages, hours, reading days, average rating, re-reads, abandoned, average length, and the year's goal cards); over the year (books and pages by month, or by year for all time, with a "?" bar for readings dated only by the year); reading days (a calendar of the year, weekday and time-of-day bars, "You read most on Sunday evenings"); ratings (the half-star distribution, the most re-read books with each read's rating); length and pace (lengths, longest and shortest, fastest and slowest from start to finish, pages an hour by language and format); languages and translation ("38% in translation; 12 from Spanish", original languages, translators); authors (by books, by pages, where they come from as a ranked list linking to the people page filtered to that nationality, gender as recorded, new authors, 24 at most, then "and 273 more"); when the books were written (by decade, then by century, movements, work types, categories); where and how (formats per session, homes by the reading's home, own copy or none); shelf time; the unread pile (always all time, with "See them", `/library?reading=unread&holding=owned`, and the copies at hand per home); recommenders (each linking to its page); abandoned (reasons, where he usually stops); insights.
- Every chart and section that leaves something out says so in a footnote: readings with unknown dates, audiobooks without pages, sessions without a start time, books read before he owned them.
- The authors' map is not reused here: it belongs to the People page (Mapbox, its own view preferences and filters), so "Where they come from" is a list of countries linking to that page's nationality filter.
- With nothing in the year: "No reading in 2026", and the unread pile still shows.

### Year in review (`/reading/year`, `/reading/year/[year]`)

`/reading/year` (SLN-456): the years with finished books (a known finish date), newest first, each a tile with the year in the stat role and "31 books", linking to its review. With none: "No finished books yet" with "Log a past read" (the book picker, then the past read dialog). `ReadingTabs` with Stats current.

`/reading/year/[year]`: one long page, a 404 for a year without finished books or any parameter that is not a four-digit year. `PageHeader` "2025 in review" with "Print" (the browser's print dialog, which also saves a PDF) and "Stats for 2025"; the header's buttons and the tabs are hidden on paper.
- **The year in numbers**: books, pages, hours, reading days in the stat role; each goal's result ("28 of 30 books in 2025. Goal reached on 14 Oct."); "You read on 126 days, in 46 of 53 weeks; 30 weeks had 5 reading days or more" (the last part with a rhythm set); a link to the journal for the year.
- **The books, month by month**: the year's finished covers in rows by month (dated only by the year: "Month unknown"), each linking to its book with its title and rating as a tooltip; at most 12 a month, then a "+38" tile to the year's finished books in the journal, so a year of hundreds of books stays within the page budget. Covers load at once, so the page prints with them.
- **Highlights**: first and last of the year (day or month precision), the longest, the highest rated (the read's rating), the most re-read, each a cover card linking to the book.
- **Authors and languages**: the busiest month (a link to its row of covers), new authors (links to their pages, 24 at most, then "and 273 more"), the countries visited through books (links to the people page's nationality filter), the share read in translation; a link to the year's finished books in the journal.
- **Favourite passage**: a favourite quote on a book finished that year, else one added that year, in `Prose`, with its book and page and a link to the book's favourite notes.
- Every block avoids a page break inside it.

### Reading journal (`/reading/journal`)

Every reading (SLN-448), from `parseJournalQuery` (`src/lib/reading/journal-params.ts`) and `queryJournal` (`src/lib/reading/journal.ts`).
- A summary of the filtered readings: "212 readings · 187 finished · 9 abandoned · 4 re-reads".
- With the Finished sort, rows sit in groups: "In progress", then each year of finish (the stop date of an abandoned read; a month or year date sits in its year), then "Date unknown".
- Each row: cover, title, author, dates (`formatReadingSpan`), outcome ("Finished · re-read"), the edition's language when it is a translation, the format, the read's rating, and a menu with Edit and Delete (with Undo).
- Filters in the URL: Status (`status`), Year range (`yearMin`, `yearMax`, on the finish or stop date), Format (`format`), Minimum rating (`minRating`, half stars), Re-reads only (`rereads=1`), and the search (`q`, title and author, accents ignored). Sorts (`sort`, `order`): Finished (newest first, unknown dates last), Started, Rating (unrated last), Title (accents ignored). Ties on the reading's id. 48 per page.
- **The read's rating** everywhere on the hub (the journal's stars, filter and sort, the Now page, the dashboard): `readingRatingSql`, the read's own rating, else the book's when it is the book's only finished read. A book rated 5 whose 2012 read was rated 3 shows 3 on that row.
- **Re-reads**: a reading is a re-read when its book has a finished reading before it in the order `getReadingsForWork` numbers by (`rereadSql`, one window over all readings). An abandoned first attempt does not make the next read a re-read.

### Reading import (`/reading/import`)

The Import tab (SLN-450). An upload area for one CSV of at most 10 MB, chosen or dropped: a Goodreads or StoryGraph export, or a Durtal reading CSV (the seed step's output and a later step's export). It goes to `POST /api/reading/import`, then the page opens the import's preview. Under it, "Past imports", newest first: the file name (a link to the preview), the date, the source, the rows, the readings imported, the rows not written, "Raw file not kept" when `imports.s3_bronze_key` is null, the status (To review, Imported, Undone) and Undo while the import has readings. Settings, Data has a row "Import reading history" in an "Import" group that links here.

### Import preview (`/reading/import/[id]`)

What an import will do, before anything is written (SLN-450), from `getImportPreview` (`src/lib/reading/import/page-data.ts`).
- The file name, the source and the upload date, then a summary: "1,204 rows · 980 exact · 120 likely · 60 to choose · 44 not in Durtal · 412 want to read · 18 already in Durtal · 6 book ratings differ".
- The commit button says what it writes ("Import 1,142 readings", "Import 1,142 readings and 23 notes", "Import 12 readings and add 4 books to Up Next", or "Add 412 books to Up Next" for a file whose readings are already in), with "60 rows not decided yet are left out" when some are pending. Beside it: Match again (while rows have no book), Undo (while the import has readings, Up Next items or notes) and All imports.
- A box "What this file cannot carry", written for the format: Goodreads' missing start dates and earlier read dates, StoryGraph's quarter stars, what is kept but not imported (books on shelves that are neither read nor to-read, moods and tags), and any missing column.
- Sections in this order, each a `SectionHeading` with its count: To choose, Likely, Not in Durtal, Exact, Want to read, Already in Durtal, Cannot import, Not imported. Want to read (SLN-452) holds the matched books of the to-read shelf (Goodreads `Exclusive Shelf`, StoryGraph `Read Status`), each noting "Already in Up Next, at 3", "Being read now" or "Read in 2019"; an unmatched one waits under Not in Durtal or To choose like any row. Imported, they go to the bottom of Up Next oldest added first; a row whose key is already there writes nothing, and a book queued by hand or started meanwhile is skipped with its reason. Undo removes the items still where the commit put them and keeps the moved or edited ones. Each shows 50 rows; "Show 50 more" raises that section's count in the URL (`?likely=100`). Likely has "Accept all likely matches"; Not in Durtal has "Skip all not in Durtal": one UPDATE each over the section's undecided rows.
- Each row: what the file says (title, author, latest read, rating), the Durtal book (cover, title, author, a link), the reason ("Same ISBN", "Same Goodreads id", "Same Goodreads link", "Same Durtal book", "Same source" for a book an earlier import of the file wrote to, "Title and author, 92%", "Chosen by you"), what will be written ("Finished 14 Apr 2019 · 4 stars · review · +2 earlier reads, dates unknown"), the book rating line ("Book rating set to 4: the book has none", or "Book rating 3 kept (the file says 4)" with "Use the file's rating"), and Import, Skip and Choose another book (the book picker). To choose rows show their candidates as buttons. Not in Durtal rows have "Add this book" (`/library/new?isbn=` or `?q=`, in a new tab); the page matches again when it becomes visible after that. A row already in Durtal only through the undated count offers "Import anyway". After the commit each row shows its outcome.
- Decisions are saved at once, one row each. Defaults: Exact rows import, and Want to read rows whose book is neither queued nor being read; Already in Durtal, Cannot import and Not imported rows skip; the rest wait.
- **Private notes** (SLN-453), after the sections: every row whose Goodreads `Private Notes` is not empty, 50 at a time ("Show 50 more", `?notes=100`). Each: the row's title and author, the book it matched (or "Choose this row's book first"), the note's first three lines (at most 300 characters), and Import and Skip (`decideImportNote`, one UPDATE of `note_decision`), or what happened: "Imported", "Already in Durtal (Same source)", "Too long to import (12,400 characters; at most 10,000)". "Import all private notes" sets every note with a book to import in one UPDATE. A note's decision is its own: a row whose readings are already in Durtal still brings its note. Default on upload: import for rows in Exact, pending otherwise; an import uploaded before this step shows its notes pending. The commit writes each note to import as a note on its book (`source` import, the row's latest read in Durtal, the key `goodreads-note:<Book Id>`), never twice; undo removes the notes not edited since and lists the kept ones.

### Reader (`/reader`)

Library of Calibre e-books (`calibre_books` table): recently read books (6), then a paginated grid of all books.

**Features**: Search by title through the `q` query parameter.

---

### Reader View (`/reader/[calibreId]`)

In-app e-book reader for one Calibre book. It opens the EPUB format first, then PDF, then the first format available. The file comes from `/api/reader/[calibreId]/file`. The position is saved to `/api/reader/[calibreId]/progress`.

---

### Places (`/places`)

Paginated index of venues (`venues` table): bookshops, online stores, museums, galleries, perfumeries, cinemas, fairs, auction houses and other places.

**Filters**: Search (`q`), venue type (`type`, comma-separated), country (`country`, comma-separated ids: a venue is in a country when its place, or a place above it, is; a venue with no place or a bare map point has none; only countries with an active venue are offered), favorites (`favorite=true`), archived (`archived=include` or `only`; archived venues are hidden by default and marked "Archived" when shown). Sort by name, recent or rating.

**Actions**: Create a venue. The create dialog can look up the venue through Google Places (`/api/venues/*`); every field can be typed by hand, and an online shop needs no address.

---

### Place Detail (`/places/[slug]`)

A venue around what it holds and sells (`src/lib/actions/venue-pages.ts`):

- Header: image, name, type, address and rating, with an actions menu on the name's cap-height center: Edit (the create form with rating, favorite and visit dates; a Google place chosen while editing replaces the venue's point, otherwise the address stays), Archive or Restore, Delete. Delete lists what still refers to the venue (orders, copies bought there, painting location records, retailer listings, institution links, sources, identifiers) and stays off; archiving keeps the history. Its images never block a delete: they go with it.
- About, then **Institution**: who runs or owns the venue, each with its other venues (branches), and "Link an institution": search an organization, or create one with the role the venue's type implies (museum, gallery, publisher; retailer for a bookshop, online store, perfumery, market or fair). A cinema, library, cafe, auction house or other venue links an existing organization only. A retailer whose listings name the branch keeps running it.
- **Here now**: each object with an open location record at this venue (`art_object_whereabouts` with no end), once, by its strongest record here (confirmed, then probable, then uncertain; the latest of equals), with its owner, custody (permanent collection, loan in, private, unknown), the occasion, start date, display state, certainty and source exactly as recorded. A holding is never read as on view.
- **Its collection elsewhere**: objects owned by the venue's institutions with no open record here: their current place (strongest open record) is another venue, a private or unknown place, or not recorded. An object is in one list only.
- **Perfumes sold here**: listings for this branch, then the online listings of the retailer that runs it, each with its formulation, the last offer seen and its date ("Checked 1 Oct 2026 (3 days ago)", with "may have changed" once stale).
- **Orders**: orders placed at this venue, newest first, with a link to all orders.
- **Bought here**: perfume bottles, film copies and art objects whose acquisition names this venue, with the date bought and their status.
- Specialties and tags, notes, and the record column (contact, opening hours, visits). Opening hours show one row per day, Monday first (`openingHoursRows`, `src/lib/catalogue/opening-hours.ts`): Google's day lines when stored, else its periods ("9:00–13:00, 14:30–18:00", "Closed", "Open 24 hours"). Hours that cannot be read are left out, never shown as raw JSON (SLN-292).
- Each part lists up to 100 rows (orders 50) and says when there are more.

### Wanted (films, perfumes, paintings)

`WantedSection` (`src/components/catalogue/wanted-section.tsx`) lists what the
collector wants to buy of the work (SLN-374): a formulation in a container size
("Eau de Parfum · Bottle · 50 ml"), a film version (and release) on a medium,
or an original or version in private or unknown hands, or a reproduction of
one. Each shows its state (Wanted, On order, Received) and its orders (status,
date, price, "in the collection" once received, a link to Provenance). "Add"
opens the wish dialog; each wish's menu has Order (method, status, date, shop,
price, shipping and currency, where it will be kept) and Remove. A wish needs
a formulation, a version or an object first; the part says so when there is
none. An order bought in a shop or received as a gift arrives at once; any
other arrives when Provenance marks it delivered, purchased or received, and
the bottle, copy or object then appears in its part.

### Provenance (`/provenance`)

Acquisition tracking (`orders` table): stats, active orders, then a paginated acquisition history.

**Actions**: Create and edit orders.

---

### Taxonomy (`/taxonomy`)

Grid of taxonomy families (`taxonomy_families` table). System families wrap the built-in vocabularies (subjects, genres, tags, themes and others). Custom families hold user-created items. There are no separate `/tags` or `/subjects` pages: each is a family here.

---

### Taxonomy Family (`/taxonomy/[familySlug]`)

Items in one family. **Actions**: Create, merge and delete items.

---

### Taxonomy Item (`/taxonomy/[familySlug]/[itemSlug]`)

The works or editions linked to one item.

---

### Settings (`/settings`)

A settings menu: `src/app/settings/layout.tsx` renders the page title and the menu (`SettingsNav`, a column beside the content from `md`, a row above it below that), and each part is its own page. The parts are listed in `SETTINGS_SECTIONS` (`src/components/settings/sections.ts`), which the command palette also searches ("Settings: Display"…). Blocks use `SettingsGroup` (a `SectionHeading` over a panel) with `SettingRow`s: the name and what it does on the left, the control on the name's cap-height center (`CapAlignedControls`), or under it (`stacked`).

- **General** (`/settings`): saved in the database (`app_settings`), for every device; each change saves at once with a toast.
  - New books: status, language (the add-book wizard and Fast Track start with these; a new edition takes the language).
  - New copies: location (or "pick for each copy"), format, condition (the wizard's copies step and the Add copy dialog; the default location sorts first).
  - Orders: home currency (new orders start in it; spending totals list it first).
- **Display** (`/settings/display`): cookies in this browser, the same ones the pages change (`src/lib/preferences.ts`): collapsed sidebar; each list's view, grid size and page size; a reset of all of them (not the reader's), after a confirmation.
- **Reader** (`/settings/reader`): font, size, line height, margins, alignment, with a preview. The same cookie as the reader's own panel.
- **Reading** (`/settings/reading`, SLN-451): saved in `app_settings` for every device. "A reading day ends at" (midnight to 06:00; "Past days stay as they were"), "A reading week starts on" (Monday or Sunday), "Days I'd like to read each week" (Off, or 1 to 7; "5 of 7 leaves room for rest days", SLN-455), "Reading goals" (the goal dialog's button), "Ask “Still reading?” after" (15 minutes to 8 hours).
- **Integrations** (`/settings/integrations`): every outside service with what it is for, the environment variables it reads (set or not, never their values) and a live check when the page opens ("Check again"). The Calibre library (books, linked, last sync) and whether the REST and media maintenance routes ask for a token.
- **Data** (`/settings/data`): catalogue counts; review queues (Identify editions and Series suggestions with counts, Publisher names and Harmonize as links); Import reading history (a link to `/reading/import`); the whole catalogue as CSV, TSV or Parquet (`POST /api/export` with `all: true`), books, authors and each open collection; refresh cached data.
- **Shortcuts** (`/settings/shortcuts`): every shortcut of the `?` sheet.
- **About** (`/settings/about`): Durtal, Next.js, React and Node.js versions; environment; schema state (migrations waiting, compared by journal time); bucket and region; which collections are open.
