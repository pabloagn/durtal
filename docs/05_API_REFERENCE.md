# API Reference

All REST API routes live under `src/app/api/`. These endpoints serve two consumers:
1. Client-side components that need to call external services (search, geocode, S3)
2. The Python TUI application (`scripts/tui/`)

The app's own pages use server actions (see [06_SERVER_ACTIONS.md](06_SERVER_ACTIONS.md)). The write routes below (orders, copies, works, editions, collections) call the same server actions, so a change through the API is the same as a change in the app: status history, activity log and catalogue status included.

### Write access

Every write route (`POST`, `PATCH`, `DELETE`) needs the header `Authorization: Bearer <DURTAL_API_TOKEN>`. The token lives in `.env.local`. When `DURTAL_API_TOKEN` is not set, every write returns `503`, so a missing setting never leaves the API open. A wrong or missing token returns `401`.

Errors: invalid input returns `400` with `{ "error": "Invalid input", "issues": [...] }`. Write bodies refuse unknown fields.

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

### `PATCH /api/works/[id]`

Change a work's title or catalogue status (as the Edit dialog does, with the activity log) and add recommenders. Needs the token.

**Body** (all optional):

| Field | Type | Description |
|---|---|---|
| `title` | string | New title |
| `catalogueStatus` | string | `tracked`, `shortlisted`, `wanted`, `on_order`, `accessioned`, `deaccessioned` |
| `addRecommenderIds` | uuid[] | Recommenders to add. Existing recommenders stay. |

**Response** `200`: `{ "id", "title", "slug", "catalogueStatus", "recommenderIds", "recommendersAdded" }`. A new title gives the work a new slug.

### `POST /api/works/refresh-slugs`

Gives every work whose slug no longer fits its title and primary author the slug it should have. Needs the token. Safe to run again: fitting slugs stay as they are.

**Query parameters**: `dryRun=1` lists the changes and writes nothing. `id=<work id>` checks one work.

**Response** `200`: `{ "dryRun", "checked", "changed", "changes": [{ "id", "title", "from", "to" }] }`

---

## Editions

### `PATCH /api/editions/[id]`

Rename an edition, as the Edit Edition dialog does (activity log included). Other fields stay as they are. Needs the token.

**Body** (all optional): `{ "title": "string", "subtitle": "string or null" }`

**Response** `200`: `{ "id", "title", "subtitle", "workId" }`. `404` when the edition does not exist.

---

## Orders

### `GET /api/orders`

With `?workId=<uuid>`: every order of that work. Without it: every active order (not delivered, cancelled or returned), with work, venue and destination.

**Response** `200`: `{ "orders": [...] }`

### `GET /api/orders/[id]`

One order with its work, edition, venue, places and status history.

### `POST /api/orders`

Create an order, as the New Order dialog does: the initial status history entry is written and the work's catalogue status follows (usually `on_order`). Needs the token.

**Body**: the fields of `createOrderSchema` (`src/lib/validations/orders.ts`). Required: `workId`, `acquisitionMethod`, `orderDate`. Money fields are strings (`"12.50"`).

```json
{
  "workId": "uuid",
  "venueId": "uuid",
  "acquisitionMethod": "online_order",
  "status": "confirmed",
  "orderDate": "2026-10-03",
  "price": "12.50",
  "shippingCost": "0.00",
  "totalCost": "12.50",
  "currency": "EUR",
  "estimatedDeliveryDate": "2026-10-09"
}
```

**Response** `201`: the order. `404` when the work does not exist.

**Response** `409` when the work already has an active order, so the same order entered twice is refused. Add `?allowDuplicate=1` to order a second copy on purpose.

### `PATCH /api/orders/[id]`

Change order details: price, dates, carrier, tracking, notes and the other `createOrderSchema` fields. `status` is refused here; use the status route. Needs the token.

### `POST /api/orders/[id]/status`

Move an order to a new status, as the order page does: the transition is checked, the history is recorded, `shippedDate` / `actualDeliveryDate` are set when empty, and the work's catalogue status follows (`accessioned` on arrival). Needs the token.

**Body**: `{ "status": "delivered", "notes": "optional" }`

**Response** `409` for a transition that is not allowed, with the allowed statuses:
```json
{ "error": "Cannot move from \"delivered\" to \"shipped\"", "allowed": ["returned"] }
```

---

## Copies

### `POST /api/instances`

Add a copy of an edition at a location, as the Add Copy dialog does. The work's catalogue status does not change here; an arrival moves its order with the status route. Needs the token.

**Body**: the fields of `createInstanceSchema` (`src/lib/validations/instances.ts`). Required: `editionId`, `locationId`.

```json
{
  "editionId": "uuid",
  "locationId": "uuid",
  "format": "paperback",
  "condition": "mint",
  "status": "available"
}
```

**Response** `201`: the copy. `404` when the edition or the location does not exist.

---

## Collections

A collection holds editions, not works, in its own order. The routes call the collection server actions (`src/lib/actions/collections.ts`), so the activity log records each book that joins or leaves. Posters and backgrounds go through `POST /api/media/upload` with `entityType: "collection"`. Body schemas: `src/lib/validations/collections-api.ts`.

### `GET /api/collections`

**Response** `200`: `{ "collections": [{ "id", "name", "description", "icon", "editionCount" }] }`

### `GET /api/collections/[id]`

One collection with its active artwork and its editions in order, each with its work and authors. `404` when it does not exist.

### `POST /api/collections`

Create a collection, as the New Collection dialog does. Needs the token.

**Body**: `name` is required. `icon` is a Lucide icon name (PascalCase, for example `Film`). `editionIds` join in the order given. The same `requestId` sent twice creates one collection.

```json
{
  "name": "Before the Film",
  "description": "string or null",
  "icon": "Film",
  "editionIds": ["uuid", "uuid"],
  "requestId": "uuid"
}
```

**Response** `201`: the collection. `404` with `{ "error": "Editions not found", "missing": [...] }` when an edition ID is unknown; nothing is created.

### `PATCH /api/collections/[id]`

Change `name`, `description` or `icon` (`null` clears the icon). Fields left out stay as they are. Needs the token.

**Response** `200`: the collection. `404` when it does not exist.

### `POST /api/collections/[id]/editions`

Add editions at the end of the collection, in the order given. An edition already in it keeps its place. Needs the token.

**Body**: `{ "editionIds": ["uuid", ...] }` (1 to 1000)

**Response** `200`: `{ "added": 2 }`. `404` with `missing` when an edition ID is unknown; nothing is added.

### `DELETE /api/collections/[id]/editions`

Take editions out of the collection. Needs the token.

**Body**: `{ "editionIds": ["uuid", ...] }`

**Response** `200`: `{ "removed": 1 }`

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

Delete a media record, then its S3 objects (full image, thumbnail, uncropped image and color original). An object that another record still references is kept.

**Response** `200`:
```json
{ "success": true }
```

### `POST /api/media/apply-crops`

One-time move of crops saved as CSS framing into cropped files (task 0155). The uncropped image stays at `uncropped_s3_key`. Rows already moved are skipped, so a second run changes nothing. Requires `x-admin-token` when `ADMIN_TOKEN` is set.

**Query**: `dryRun=1` lists the rows and changes nothing. `id=<media id>` limits the run to one item.

**Response** `200`:
```json
{ "total": 169, "applied": 168, "unchanged": 1, "failed": [] }
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
