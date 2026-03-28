# Terminal UI

Durtal includes a Python-based terminal user interface (TUI) built with Textual. It provides a keyboard-driven interface for browsing the library, viewing statistics, and uploading media — all from the terminal.

The TUI communicates with the Next.js application via its REST API endpoints.

---

## Architecture

```
scripts/tui/
+-- app.py                 Main application entry point
+-- api_client.py          Async HTTP client for the Durtal API
+-- screens/
|   +-- __init__.py
|   +-- dashboard.py       Library statistics overview
|   +-- browse.py          Search and browse works
|   +-- upload.py          Batch media file uploads
+-- widgets/
|   +-- __init__.py
|   +-- stat_card.py       Statistic display widget
|   +-- work_table.py      Book listing data table
|   +-- progress_panel.py  Upload progress tracker
+-- styles/
    +-- durtal.tcss         Textual CSS stylesheet
```

---

## Running

```bash
uv run python -m scripts.tui.app
```

Or via Taskfile:

```bash
task tui
```

The TUI connects to the API at `DURTAL_API_URL` (loaded from `.env.local`, defaults to `http://localhost:3003`).

---

## Application (`app.py`)

The root `DurtalApp` class extends `textual.app.App`.

**Title**: `D U R T A L`

**Global keybindings**:

| Key | Action |
|---|---|
| `q` | Quit |
| `d` | Go to Dashboard |
| `b` | Go to Browse |
| `u` | Go to Upload |

Navigation works by popping the current screen stack and pushing the target screen. All screens share a single `DurtalClient` instance.

---

## Screens

### Dashboard (`screens/dashboard.py`)

Displays library statistics and recent additions.

**Layout**:
- Title label: "D U R T A L"
- 4 stat cards in a horizontal row: Works, Editions, Instances, Authors
- Work table showing recent additions (title, author, year, language, copies, rating)

**Data source**: `GET /api/stats`

**Keybindings**: `r` to refresh.

**Behavior**:
- On mount, spawns an async worker to fetch stats
- Updates stat cards and populates the work table when data arrives
- Shows loading state while fetching

### Browse (`screens/browse.py`)

Search and browse the library with a detail panel.

**Layout**:
- Search input field (top)
- Work table (left, 60% width)
- Detail panel (right, 40% width)

**Data source**: `GET /api/works?q={search}&sort=recent&limit=100`

**Keybindings**: `Esc` (back), `r` (refresh), `/` (focus search).

**Behavior**:
- Search input triggers a work list refresh on submit
- Selecting a row in the work table fetches full work details via `GET /api/works/{id}`
- Detail panel displays:
  - Title, authors, year, language
  - Catalogue status, rating
  - Edition count, subject list
  - Media file count
  - First 200 characters of description

### Upload (`screens/upload.py`)

Batch media upload interface with a file browser and progress tracking.

**Layout**:
- Directory tree file browser (left)
- Configuration panel (right):
  - Entity type selector: Work | Author
  - Entity ID input (UUID)
  - Media type selector: Poster | Background | Gallery
- Progress panel (bottom)
- Upload All / Clear buttons

**Behavior**:
1. User selects files or directories from the file browser (filters to image files)
2. User configures entity type, entity ID, and media type
3. "Upload All" triggers the batch upload

**Upload flow per file** (three-step process):

```
Step 1: Presign
  POST /api/media/process { action: "presign", entityType, entityId, filename, contentType }
  -> Returns { url, bronzeKey, fileId }

Step 2: Upload to S3
  PUT {presigned URL} with raw file bytes
  -> File lands in bronze/ on S3

Step 3: Process
  POST /api/media/process { action: "process", entityType, entityId, mediaType, fileId, bronzeKey }
  -> Server processes image, stores in gold/, creates DB record
```

**Progress tracking**: Each file shows a progress bar with status labels: presigning -> uploading -> processing -> complete/error.

---

## Widgets

### StatCard (`widgets/stat_card.py`)

A simple widget displaying a single statistic.

```
  1,234
  Works
```

Methods:
- `__init__(label, value)`: Initialize with label and value
- `update_value(value)`: Update the displayed value

### WorkTable (`widgets/work_table.py`)

Pre-configured `DataTable` for displaying work listings.

**Columns**: Title, Author, Year, Language, Copies, Rating.

**Features**:
- Row cursor (click to select)
- Zebra striping
- Work ID stored as row key for selection handling

**Method**: `load_works(works)` populates the table from a list of work dicts. Extracts first author name, counts total instances across all editions, uses publication year or original year.

### ProgressPanel (`widgets/progress_panel.py`)

Tracks multiple concurrent file uploads.

**Methods**:
- `add_item(key, filename)`: Add a new file to track
- `update_item(key, progress, status)`: Update progress bar and status
- `clear_all()`: Reset all tracking

---

## Styling (`styles/durtal.tcss`)

The TUI uses Textual CSS (TCSS) with the same dark gothic-minimal aesthetic as the web application.

**Key style mappings**:

| Element | Color | Source |
|---|---|---|
| Screen background | `#030507` | `--color-bg-primary` |
| Panel background | `#0a0d10` | `--color-bg-secondary` |
| Primary text | `#c1c6c4` | `--color-fg-primary` |
| Secondary text | `#7d8380` | `--color-fg-secondary` |
| Gold accent | `#c0a36e` | `--color-accent-gold` |
| Primary button | `#7d3d52` | `--color-accent-rose` |
| Success | `#5a8a6a` | Derived from `--color-accent-sage` |
| Error | `#b54a4a` | Derived from `--color-accent-red` |
| Table header | `#c0a36e` | Gold accent |
| Table cursor | `#7d3d52` | Rose accent |
| Input focus | `#7d3d52` border | Rose accent |
| Progress bar | `#7d3d52` fill, `#5a8a6a` complete | Rose -> Sage |

---

## API Contract

The TUI consumes the following API endpoints:

| Endpoint | Method | Screen | Purpose |
|---|---|---|---|
| `/api/health` | GET | (available) | Health check |
| `/api/stats` | GET | Dashboard | Library statistics |
| `/api/works` | GET | Browse | Search and list works |
| `/api/works/{id}` | GET | Browse | Work detail for side panel |
| `/api/authors` | GET | (available) | Author listing |
| `/api/authors/{id}` | GET | (available) | Author detail |
| `/api/media/process` | POST | Upload | Pre-sign and process media |
| `{presigned S3 URL}` | PUT | Upload | Direct S3 upload |

The API client (`api_client.py`) manages HTTP connections via `httpx.AsyncClient` with lazy initialization and explicit cleanup on app exit.
