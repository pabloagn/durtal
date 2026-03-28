# API Reference

All REST API routes live under `src/app/api/`. These endpoints serve two consumers:
1. Client-side components that need to call external services (search, geocode, S3)
2. The Python TUI application (`scripts/tui/`)

CRUD operations use server actions (see [06_SERVER_ACTIONS.md](06_SERVER_ACTIONS.md)), not REST endpoints.

---

## Health

### `GET /api/health`

Health check endpoint used by Docker healthcheck and monitoring.

**Response** `200`:
```json
{
  "status": "ok",
  "service": "durtal",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Stats

### `GET /api/stats`

Library statistics for dashboard and TUI.

**Response** `200`:
```json
{
  "works": 1234,
  "editions": 1567,
  "instances": 2045,
  "authors": 892,
  "recentWorks": [
    {
      "id": "uuid",
      "title": "Don Quixote",
      "originalYear": 1605,
      "catalogueStatus": "catalogued",
      "rating": 5,
      "createdAt": "2024-01-15T10:30:00.000Z",
      "editions": [...],
      "workAuthors": [...]
    }
  ]
}
```

`recentWorks` returns the 8 most recently added works with their editions, authors, and media.

---

## Search

### `GET /api/search`

Search external book databases for metadata. Queries Google Books and Open Library in parallel.

**Query parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | one of `q` or `isbn` | Free-text search query |
| `isbn` | string | one of `q` or `isbn` | ISBN-10 or ISBN-13 |
| `source` | string | no | `google`, `openlibrary`, or omit for both |

**Response** `200`:
```json
[
  {
    "source": "google",
    "sourceId": "abc123",
    "title": "Don Quixote",
    "subtitle": "A Novel",
    "authors": ["Miguel de Cervantes"],
    "publisher": "Penguin Classics",
    "publishedDate": "2003-02-25",
    "publicationYear": 2003,
    "description": "...",
    "isbn13": "9780142437230",
    "isbn10": "0142437239",
    "pageCount": 1023,
    "categories": ["Fiction"],
    "coverUrl": "https://books.google.com/...",
    "language": "en"
  }
]
```

**Error** `400`: Missing both `q` and `isbn` parameters.

---

## Works

### `GET /api/works`

List works with pagination and search.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Search term (title, author, ISBN) |
| `sort` | string | `recent` | One of: `recent`, `title`, `year`, `rating` |
| `limit` | number | `50` | Results per page |
| `offset` | number | `0` | Pagination offset |

**Response** `200`:
```json
{
  "works": [
    {
      "id": "uuid",
      "title": "Don Quixote",
      "originalLanguage": "es",
      "originalYear": 1605,
      "catalogueStatus": "catalogued",
      "rating": 5,
      "editions": [...],
      "workAuthors": [{ "author": { "name": "Miguel de Cervantes" }, "role": "author" }]
    }
  ],
  "total": 1234
}
```

### `GET /api/works/[id]`

Fetch a single work with all relations loaded.

**Response** `200`: Full `WorkWithRelations` object including editions, instances, authors, subjects, media, contributors, genres, and tags.

**Response** `404`:
```json
{ "error": "Work not found" }
```

---

## Authors

### `GET /api/authors`

List authors with pagination and search.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | — | Search by name |
| `limit` | number | `100` | Results per page |
| `offset` | number | `0` | Pagination offset |

**Response** `200`:
```json
{
  "authors": [
    {
      "id": "uuid",
      "name": "Gabriel Garcia Marquez",
      "sortName": "Garcia Marquez, Gabriel",
      "nationality": "Colombian",
      "birthYear": 1927,
      "deathYear": 2014,
      "workAuthors": [...]
    }
  ],
  "total": 892
}
```

### `GET /api/authors/[id]`

Fetch a single author with works and edition contributions.

**Response** `200`: Full `AuthorWithRelations` object.

**Response** `404`:
```json
{ "error": "Author not found" }
```

---

## Media

### `DELETE /api/media/[id]`

Delete a media record and its associated S3 objects (both full image and thumbnail).

**Response** `200`:
```json
{ "success": true }
```

### `POST /api/media/process`

Two-phase media upload endpoint.

#### Phase 1: Pre-sign

Get a pre-signed S3 URL for the client to upload the raw file to bronze storage.

**Request body**:
```json
{
  "action": "presign",
  "entityType": "work",
  "entityId": "uuid",
  "filename": "cover.jpg",
  "contentType": "image/jpeg"
}
```

**Response** `200`:
```json
{
  "url": "https://s3.amazonaws.com/durtal/bronze/media/...",
  "bronzeKey": "bronze/media/work/uuid/fileid.jpg",
  "fileId": "generated-uuid"
}
```

#### Phase 2: Process

After the client uploads the raw file to S3, trigger server-side processing (resize, convert to WebP, create thumbnail, store in gold).

**Request body**:
```json
{
  "action": "process",
  "entityType": "work",
  "entityId": "uuid",
  "mediaType": "poster",
  "fileId": "uuid-from-presign",
  "bronzeKey": "bronze/media/work/uuid/fileid.jpg",
  "originalFilename": "cover.jpg",
  "mimeType": "image/jpeg"
}
```

**Response** `200`:
```json
{
  "media": {
    "id": "uuid",
    "type": "poster",
    "s3Key": "gold/media/work/uuid/poster/fileid.webp",
    "thumbnailS3Key": "gold/media/work/uuid/poster/fileid_thumb.webp",
    "width": 800,
    "height": 1200
  }
}
```

---

## S3

### `POST /api/s3/presign`

Generate pre-signed URLs for direct S3 operations.

**Request body**:
```json
{
  "key": "gold/covers/uuid/cover.webp",
  "contentType": "image/webp",
  "action": "upload"
}
```

`action` is either `"upload"` (PUT URL) or `"read"` (GET URL). Expiry: 1 hour.

**Response** `200`:
```json
{
  "url": "https://s3.amazonaws.com/durtal/gold/covers/..."
}
```

### `GET /api/s3/read`

Redirect to a pre-signed read URL for an S3 object.

**Query parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | S3 object key |

**Response**: `302` redirect to pre-signed URL (1-hour expiry).

---

## Geocode

### `GET /api/geocode`

Geocoding proxy for location address entry. Integrates with Nominatim (OpenStreetMap). Rate-limited to 1 request per second.

**Three modes**:

#### Postal Code Lookup

```
GET /api/geocode?mode=postal&postalcode=1012&country=NL
```

#### Reverse Geocoding

```
GET /api/geocode?mode=reverse&lat=52.3676&lon=4.9041
```

#### Free-Text Search

```
GET /api/geocode?mode=search&q=Amsterdam
```

**Response** `200` (all modes):
```json
{
  "results": [
    {
      "street": "Dam",
      "city": "Amsterdam",
      "region": "Noord-Holland",
      "country": "Netherlands",
      "countryCode": "NL",
      "postalCode": "1012",
      "latitude": 52.3676,
      "longitude": 4.9041,
      "displayName": "Dam, Amsterdam, Noord-Holland, Netherlands"
    }
  ]
}
```

**Error** `400`: Missing required parameters.
**Error** `429`: Rate limited (Nominatim allows 1 request/second).
