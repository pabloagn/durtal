# Routes and Views

## Route Map

```
/                           Dashboard
/library                    Main catalogue view
/library/[slug]             Work detail page (slug format: {title}-by-{author})
/library/new                Add new book (wizard)
/library/import             Bulk import interface
/authors                    Author index
/authors/[slug]             Author detail (slug format: {author-name})
/series                     Series index
/series/[id]                Series detail
/locations                  Location management
/collections                Collection management
/tags                       Tag management
/subjects                   Subject management
/settings                   Application settings
```

All data pages use `force-dynamic` rendering — no static generation, no ISR. Every request fetches fresh data from Neon.

---

## Navigation

### Sidebar

Fixed left sidebar (`w-56`, `h-dvh`, `z-40`). Always visible on desktop.

Structure from top to bottom:
1. **Logo**: "Durtal" text
2. **Search trigger**: Button that opens the command palette (`Cmd+K`)
3. **Navigation links**:
   - Dashboard (`/`)
   - Library (`/library`)
   - Authors (`/authors`)
   - Series (`/series`)
   - Locations (`/locations`)
   - Collections (`/collections`)
   - Tags (`/tags`)
   - Settings (`/settings`)
4. **Footer**: "catalogue . index . archive" text

Active route is highlighted with `bg-accent-plum`.

### Command Palette

Full-screen overlay activated by `Cmd+K` (or `Ctrl+K` on non-Mac). Uses the `cmdk` library.

Two groups:
- **Navigate**: Links to all main sections (Dashboard, Library, Authors, Locations, Collections, Tags, Settings)
- **Actions**: Add Book, Import Books

Features:
- Real-time fuzzy filtering
- Auto-focus on input
- `Escape` to close
- Glassmorphic backdrop with blur

### Shell

The root `Shell` component wraps all page content:
- Renders the `Sidebar`
- Applies `ml-56` margin to main content (accounts for sidebar width)
- Manages keyboard shortcuts (Cmd+K → palette, Esc → close)
- Renders `CommandPalette` and `Toaster` (sonner)

---

## Page Descriptions

### Dashboard (`/`)

The landing page. Provides an overview of the entire library.

**Stats cards** (top row):
- Works count
- Editions count
- Instances count
- Authors count
- Books per location breakdown
- Books per catalogue status

**Quick actions**:
- Add book → navigates to `/library/new`
- Import → navigates to `/library/import`
- Quick add: Inline ISBN input field for rapid entry

**Recent additions**:
- Grid of the 8 most recently added works
- Each shows cover thumbnail, title, author, year

**Additional panels**:
- Location breakdown (visual, minimal chart)
- Wishlist count with "next to buy" highlights
- Series count, complete series count

---

### Library (`/library`)

The main catalogue view. Displays all works with pagination and search.

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

### Series (`/series`)

Index of all book series in the library.

**Columns**: Title, original title, work count (total and owned), completion status.

**Features**: Search by title.

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

### Tags (`/tags`)

Tag management interface.

**Per tag**: Name, optional color, edition count.

**Management**: Create, edit, delete tags. Color picker for visual categorization.

---

### Settings (`/settings`)

Static configuration information page.

**Sections**:
- Database: Neon connection info
- External APIs: Google Books, Open Library status
- Storage: S3 bucket and region
- About: Application version (0.1.0)
