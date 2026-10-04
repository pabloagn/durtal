# Routes and Views

## Route Map

```
/                           Dashboard
/library                    Books: the book collection's home (title "Books")
/library/[slug]             Work detail page (slug format: {title}-by-{author})
/library/new                Add new book (wizard)
/library/import             Bulk import interface
/library/identify           Identify placeholder editions (one at a time)
/authors                    Author index
/authors/[slug]             Author detail (slug format: {author-name})
/publishers                 Publisher index
/publishers/new             Add a publisher
/publishers/review          Review publisher names on editions
/publishers/[slug]          Publisher detail
/publishers/[slug]/edit     Edit a publisher
/recommenders               Recommender index
/recommenders/[id]          Recommender detail
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
/harmonize                  Library-wide data harmonization
/settings                   Settings: General (defaults for new records)
/settings/display           Settings: lists, sidebar (this browser)
/settings/reader            Settings: reader typography (this browser)
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
   (`DOMAIN_ORDER`), then Reader, Authors, Publishers, Recommenders, Series,
   Places, Provenance, Locations, Collections, Taxonomy, Harmonize, Settings.
   Icons come from `SECTION_ICONS` and `DOMAIN_ICONS`
   (`src/components/shortcuts/section-icons.ts`).
4. **Footer**: "catalogue . index . archive" text

Active route is highlighted with `bg-accent-plum`.

### Command Palette

Full-screen overlay activated by `Cmd+K` (or `Ctrl+K` on non-Mac). Uses the `cmdk` library.

Groups:
- **Books** and **Authors**: matches for the typed text, each with its picture: the book's cover (its active poster, else an edition's), 24x36 like a small card, or the author's portrait, 28px square on the same 36px row; with no picture, the initials on the tint taken from the name, as on the cards. The pictures load lazily in a fixed box, so the list never moves
- **Search**: one "Search books for …" entry per open collection
- **This page**: the page's Edit menu entries ("Edit work", `E W`) and Copy menu entries
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
- Wraps everything in `ShortcutsProvider` (`src/components/shortcuts/`): Cmd+K → palette (searches books and authors), `/` → list search, `A` → the Add menu (one entry per open collection, then author, publisher, recommender, series, collection, place), `G` → the Go to menu (an open collection's home is `G` then its `keys.go`: Books is `G B`), `Y` → the Copy menu (the page's name, title, ISBN, address and link; pages give theirs with `CopyShortcuts`), `E` → the Edit menu (the page's edit actions, given with `useEditActions`; on the book page `E W` edits the work, `E M` opens the media manager, `E T` edits the taxonomy; on a page with no edit actions `E` does nothing), ↑ ↓ and Enter → pick in any search list, Enter / Cmd+Enter → confirm or save in dialogs and the Add Book steps, `?` → the shortcut sheet. The list lives in `src/lib/shortcuts/shortcuts.ts`
- Renders `CommandPalette` and `Toaster` (sonner)

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
- **List**: Compact card list
- **Table**: High-density data table with configurable columns

**Grid size slider**: Adjusts the number of columns in grid view.

**Column configuration** (table view): Dialog to select which columns are visible.

**Controls**:
- Search: Full-text across work title, edition title, author name, ISBN, publisher, description
- Sort: Title (work), Author (sort name), Date Added, Original Year, Edition Year, Page Count, Language, Rating
- Pagination: 48 items per page

**Filter sidebar** (collapsible):
- Status: All, Catalogued, Wishlist, On Order
- Location: All, per-location
- Genre: Multi-select
- Author: Searchable select
- Tags: Multi-select
- Format: Hardcover, Paperback, Digital
- Language: Multi-select

**Bulk selection**: Select multiple works for batch operations (move, tag, delete, change status).

**Empty state**: Displayed when no works match the current filter/search. Provides a link to add the first book.

**Book card** contents:
- Cover image (from S3 thumbnail)
- Title (serif)
- Primary author name
- Original year
- Language badge
- Instance count
- Rating (if set)

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
| `house`, `perfumer` | Organization or person ids; any one listed |
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
storage place, acquisition); Retailers (listings with recorded prices);
Gallery; Sources (cited sources, and sources a reader adds); Your notes;
related perfumes ("More from {house}", "More by {perfumer}", "Shared notes").

Create and edit share `PerfumeForm`: title, houses (house, brand, manufacturer),
people (perfumer, creative director, with "Unknown"), launch and
discontinuation dates of any precision, description, and (on create) notes by
position, families and accords. Dialogs add and edit formulations, bottles and
samples, retailer listings and prices, and sources. A perfume with bottles,
samples or listings cannot be deleted; the dialog says what to do first.
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
format, date, distributor), Copies, Sources and Your notes. The record column holds
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
copies, cannot be deleted; the dialog says what to do first.

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
original and its versions, reproductions, Sources and Your notes. Each object
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
deleted; the dialog says what to do first.

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
- Rating (1-5)
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

---

### Bulk Import (`/library/import`)

Interface for importing books in bulk from external sources.

**Supported sources**:
- Goodreads CSV export
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

### Authors (`/authors`)

Table view of all authors in the database.

**Columns**: Name, Nationality, Birth-Death years, Works count.

**Features**:
- Search by name
- Alphabetical ordering by sort name
- Click row to navigate to author detail

---

### Author Detail (`/authors/[slug]`)

Full author profile page.

**Author header**:
- Optional poster image (from media)
- Name, nationality
- Birth and death years
- Bio text

**Media section**: Upload and gallery for author images.

**Works authored**: List of works with role badges (author, co-author).

**Edition contributions**: List of editions where this author is a contributor (translator, editor, illustrator, etc.).

**External links**: Website, Open Library, Goodreads.

---

### Publishers (`/publishers`)

- Grid, list and detailed views; each card leads with the house's logo, whole on a dark tile (the first letter when there is none), then its name, kind, country and edition count.

### Publisher Detail (`/publishers/[slug]`)

- Header like the author page: the house's background banner and backdrop, its logo (shown whole, never cropped), the name, what it is (imprint of, group) and where, the favourite star, Edit and an actions menu (Copy name, Edit, Manage media, View in library). Manage media opens the shared media manager with a Logo and a Background tab (owner `organization`).
- Reading column: About (`<Prose>`), notes, then the books as a catalogue: one card per book with this house's edition cover (owned edition first, then one with a cover, then the earliest), in grid or list view. The house's imprints count as the house.
- Search, filters (status: owned, wanted, on order; marks; imprint; language; publication years as a range; binding; author), sort (title, author, year, recent) and pagination run on the server (`src/lib/publishers/books.ts`) and live in the URL. The old `?filter=` tab links still open the same view.
- Record column: the counts (books, editions, owned, wanted, on order), details (country, group, imprints, other names, specialties, ISBN prefixes) and the website.
- Below: books wanted from this house (acquisition targets not yet received). Loading skeleton, an empty state for a house with no books, and a not-found page.

### Series (`/series`)

Index of all book series in the library.

**Features**: Paginated list. Sort by relevance, title, book count or recent. A link opens `/series/suggestions` when some books match a series by title.

---

### Series Detail (`/series/[id]`)

Single series view.

**Header**: Series title, original title, description, completion indicator.

**Works list**: Ordered by `series_position`. Each entry shows cover thumbnail, title, authors, position number.

---

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

Grid of curated edition collections.

**Per collection card**: Name, description, edition count, cover image.

**Management**: Create, edit, delete collections. Add/remove editions. Reorder editions within a collection.

---

### Reader (`/reader`)

Library of Calibre e-books (`calibre_books` table): recently read books (6), then a paginated grid of all books.

**Features**: Search by title through the `q` query parameter.

---

### Reader View (`/reader/[calibreId]`)

In-app e-book reader for one Calibre book. It opens the EPUB format first, then PDF, then the first format available. The file comes from `/api/reader/[calibreId]/file`. The position is saved to `/api/reader/[calibreId]/progress`.

---

### Places (`/places`)

Paginated index of venues (`venues` table): bookshops, online stores, fairs, auction houses and other places books come from.

**Filters**: Search (`q`), venue type (`type`, comma-separated), favorites (`favorite=true`). Sort by name, recent or rating.

**Actions**: Create a venue. The create dialog can look up the venue through Google Places (`/api/venues/*`).

---

### Place Detail (`/places/[slug]`)

Single venue view: contact details, opening hours, visits, description, specialties and notes.

---

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
- **Integrations** (`/settings/integrations`): every outside service with what it is for, the environment variables it reads (set or not, never their values) and a live check when the page opens ("Check again"). The Calibre library (books, linked, last sync) and whether the REST and media maintenance routes ask for a token.
- **Data** (`/settings/data`): catalogue counts; review queues (Identify editions and Series suggestions with counts, Publisher names and Harmonize as links); the whole catalogue as CSV, TSV or Parquet (`POST /api/export` with `all: true`); refresh cached data.
- **Shortcuts** (`/settings/shortcuts`): every shortcut of the `?` sheet.
- **About** (`/settings/about`): Durtal, Next.js, React and Node.js versions; environment; schema state (migrations waiting, compared by journal time); bucket and region; which collections are open.
