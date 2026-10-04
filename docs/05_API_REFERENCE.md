# API Reference

All REST API routes live under `src/app/api/`. These endpoints serve two consumers:
1. Client-side components that need to call external services (search, geocode, S3)
2. The Python TUI application (`scripts/tui/`)

The app's own pages use server actions (see [06_SERVER_ACTIONS.md](06_SERVER_ACTIONS.md)). The write routes below (orders, copies, works, editions, collections) call the same server actions, so a change through the API is the same as a change in the app: status history, activity log and catalogue status included.

### Write access

The write routes for works, editions, orders, copies and collections (the routes that use `src/lib/api/rest.ts`) need the header `Authorization: Bearer <DURTAL_API_TOKEN>`. The token lives in `.env.local`. When `DURTAL_API_TOKEN` is not set, these writes return `503`, so a missing setting never leaves them open. A wrong or missing token returns `401`.

The media, S3, comments, export, reader and venues routes do not check this token. The app's own pages call them. The admin media jobs check `x-admin-token` instead (see Media).

Errors: invalid input returns `400` with `{ "error": "Invalid input", "issues": [...] }`. Write bodies refuse unknown fields.

### Same-origin check

Every `/api/*` route refuses a call that a web page on another origin makes through the browser. `src/proxy.ts` runs the check before the route, and it answers `403` with `{ "error": "Refused: the request comes from another site" }`. The app's own pages pass. So does opening a URL directly in the address bar.

The browser says where a call comes from. The check reads `Sec-Fetch-Site` (`same-origin` and `none` pass) and, when an older browser does not send it, compares `Origin` with `Host`. A call with neither header does not come from a web page (curl, the TUI, a script) and passes. This check does not replace the write token. It does not stop another device on the network either: binding the dev server to `127.0.0.1` does that.

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
      "catalogueStatus": "accessioned",
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
      "catalogueStatus": "accessioned",
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

**Response** `200`: `{ "id", "title", "slug", "catalogueStatus", "recommenderIds", "recommendersAdded" }`. A new title gives the work a new slug. An unknown recommender id returns `404` (`"Recommender not found"`), and nothing in the request is written.

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

## Export

### `POST /api/export`

Download books, authors, perfumes, films or paintings as a file. Used by the export menus of the book and author pages, the bulk toolbars, and Settings → Data. No token.

**Body**:

| Field | Type | Description |
|---|---|---|
| `entity` | `"works"` \| `"authors"` \| `"perfumes"` \| `"films"` \| `"paintings"` | Books, authors of books, or the records of an open collection (one row each: makers, dates, classification, holdings, rating, favourite, notes) |
| `ids` | string[] | 1–500 ids to export. Not needed with `all` |
| `all` | boolean | `true`: every record of the entity instead of `ids` |
| `format` | `"csv"` \| `"tsv"` \| `"parquet"` | File format |

**Response** `200`: the file, with `Content-Disposition: attachment; filename="durtal-{entity}-{date}.{ext}"` (`durtal-books-all-…`, `durtal-authors-all-…`, `durtal-perfumes-all-…` and so on with `all`, a slug of the name for a single record).

**Response** `400`: a bad entity, format or id list. `404`: no record matched, or the collection is not open. `500`: `{ "error": "Export failed." }`.

---

## Media

### `DELETE /api/media/[id]`

Delete a media record (`id` a UUID, else `400`), then its S3 objects (full image, thumbnail, uncropped image and color original). An object that another record still references is kept.

**Response** `200`:
```json
{ "success": true }
```

### `POST /api/media/apply-crops`

One-time move of crops saved as CSS framing into cropped files (task 0155b). The uncropped image stays at `uncropped_s3_key`. Rows already moved are skipped, so a second run changes nothing. Requires the `x-admin-token` header to match `ADMIN_TOKEN`. When `ADMIN_TOKEN` is not set, the route answers 503 (see [11_DEPLOYMENT.md](11_DEPLOYMENT.md), Admin Token).

**Query**: `dryRun=1` lists the rows and changes nothing. `id=<media id>` limits the run to one item.

**Response** `200`:
```json
{ "total": 169, "applied": 168, "unchanged": 1, "failed": [] }
```

### `POST /api/media/process`

Two-phase media upload endpoint.

#### Phase 1: Pre-sign

Get a pre-signed S3 URL for the client to upload the raw file to bronze storage. `entityId` must be a UUID of an existing owner (`400` for a malformed id, `404` for a missing owner) and `contentType` a JPEG, PNG, WebP or GIF; the key's extension comes from `contentType`, not from `filename`.

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

After the client uploads the raw file to S3, trigger server-side processing (resize, convert to WebP, create thumbnail, store in gold). `bronzeKey` must be the key phase 1 returned for this `entityType`, `entityId` and `fileId` (all UUIDs); any other key is refused with `400`, and nothing is read or written.

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

### `POST /api/media/logo-card`

An organization's logo card (SLN-441): one 1200×800 black card with the logo in one light ink. Multipart fields: `organizationId` (uuid), `options` (JSON: `invert`, `keepColours`, `emblemOnly`, `badge`, `size` of -1, 0 or 1), and either `file` (SVG, PNG, JPEG or WebP) or `mediaId` (a saved card, whose kept original runs again). With `preview=1` the answer is the card as `image/png` and nothing is stored; otherwise the card becomes the active logo and the answer is `{ "media" }`. `400` for a bad id, file, JSON or an image with no logo; `404` for an unknown organization or a card with no original.

### `POST /api/media/upload`

Multipart upload. The server processes the image and writes it to S3. This avoids CORS problems with pre-signed URLs.

**Form fields**:

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | yes | JPEG, PNG, WebP or GIF. Maximum 50 MB |
| `entityType` | string | yes | `work`, `author`, `collection`, `organization`, `art_object` or `perfume_variant` |
| `entityId` | string | yes | ID of the owner |
| `mediaType` | string | yes | `poster`, `background` or `gallery` |
| `attribution` | JSON string | no | `altText`, `credit`, `license`, `licenseUrl`, `sourceUrl`, `sourceRecordId` |
| `processingParams` | JSON string | no | Author only. Monochrome settings |

A collection takes no `gallery` image. An organization, art object or perfume variant takes no `background` image.

**Response** `200`: `{ "media": { ...media record } }`.
**Error** `400`: Missing field, bad `mediaType`, owner does not take that image type, file too large, type not allowed, empty file, or invalid attribution. A broken multipart body returns `code: "INVALID_MULTIPART"` and a `requestId`. **Error** `404`: Owner not found.

### `POST /api/media/from-url`

Downloads an image from a URL and runs the same pipeline as `/api/media/upload`. The URL is stored as the image's `sourceUrl` unless `attribution` gives one.

**Request body**:
```json
{
  "entityType": "work",
  "entityId": "uuid",
  "mediaType": "poster",
  "imageUrl": "https://example.com/cover.jpg",
  "caption": "optional",
  "attribution": { "credit": "optional" },
  "processingParams": { "contrast": 1.0 }
}
```

`entityType` defaults to `work`. The legacy field `workId` is accepted in place of `entityId`. The download goes through `safeFetchImage` (`src/lib/net/safe-fetch.ts`): HTTPS to public hosts only, limited redirects, a timeout, 50 MB maximum and image types only.

**Response** `200`: `{ "media": { ...media record } }`.
**Error** `400`: Missing field, bad `mediaType`, owner does not take that image type, or a refused download (the message names the reason). **Error** `404`: Owner not found.

### `GET /api/media/preview-monochrome`

Returns a preview of an author image with new monochrome settings. It reads the stored original and writes nothing to S3.

**Query parameters**:

| Param | Type | Default | Description |
|---|---|---|---|
| `mediaId` | string | — | Required. A media record with an original |
| `contrast` | number | `1.0` | |
| `sharpness` | number | `1.0` | |
| `gamma` | number | `2.2` | |
| `brightness` | number | `1.0` | |

**Response** `200`: `image/webp` bytes, at most 800 x 1200, `Cache-Control: no-store`.
**Error** `400`: Missing `mediaId` or bad settings. **Error** `404`: No media record or no original.

### `POST /api/media/reprocess-author`

Re-processes one author image from its stored original with new monochrome settings. The original is never changed. A saved crop is applied again.

**Request body**:
```json
{ "mediaId": "uuid", "processingParams": { "grayscale": true, "contrast": 1.2, "sharpness": 1.0, "gamma": 2.2, "brightness": 1.0 } }
```

**Response** `200`: `{ "media": { ...updated media record } }`.
**Error** `400`: Missing `mediaId` or bad settings. **Error** `404`: No media record or no original. **Error** `409`: The image changed during the edit.

### `POST /api/media/reprocess`

Admin bulk job. Regenerates the thumbnail of every media record from its full-size image (800 x 1200, WebP quality 82). Requires `x-admin-token` when `ADMIN_TOKEN` is set.

**Response** `200`:
```json
{ "total": 120, "success": 118, "failed": 2, "errors": ["uuid: message"] }
```

`errors` holds at most 10 entries. **Error** `401`: Wrong admin token.

### `POST /api/media/backfill-palettes`

Admin bulk job. Extracts a color palette for every poster that has none. Requires `x-admin-token` when `ADMIN_TOKEN` is set.

**Response** `200`:
```json
{ "total": 40, "processed": 39, "failed": 1, "errors": ["uuid: message"] }
```

**Error** `401`: Wrong admin token.

---

## Comments

Comments attach to a work or an author. Adding a comment also records an activity event.

### `GET /api/comments`

**Query parameters**: `entityType` (`work` or `author`) and `entityId` (a UUID). Both are required.

**Response** `200`: Array of comments with their `attachments`, newest first.
**Error** `400`: Missing or invalid parameter.

### `POST /api/comments`

**Request body**:
```json
{ "entityType": "work", "entityId": "uuid", "contentHtml": "<p>Text</p>", "contentJson": {} }
```

`contentHtml` is 1 to 50,000 characters. The server sanitizes it. `contentJson` is optional.

**Response** `201`: The comment, plus `eventId` of the activity event.
**Error** `400`: Invalid body.

### `PATCH /api/comments/[commentId]`

**Request body**: `{ "contentHtml": "...", "contentJson": {} }`.

**Response** `200`: The updated comment. **Error** `400`: Invalid comment id or body. **Error** `404`: Comment not found.

### `DELETE /api/comments/[commentId]`

Deletes the comment and its activity event in one transaction. The attachments go with the comment (cascade), then their S3 files are removed.

**Response** `200`: `{ "success": true }`. **Error** `404`: Comment not found.

### `POST /api/comments/[commentId]/attachments`

Multipart upload with one `file` field. Maximum 25 MB per file and 10 attachments per comment. Accepted: images (jpg, png, gif, webp, avif, svg), documents (pdf, doc, docx, xls, xlsx, odt, ods, rtf, epub), text and code (txt, md, csv, json and plain-text source files) and archives (zip, gz, tar); programs and scripts are refused (`src/lib/s3/attachment-types.ts`). The stored and served type comes from the extension, not from the browser.

**Response** `201`: The attachment record (`fileName`, `fileSize`, `mimeType`, `s3Key`, `isImage`).
**Error** `400`: Invalid comment id, no file, a file type not on the list, file too large, or 10 attachments already. **Error** `404`: Comment not found.

### `DELETE /api/comments/[commentId]/attachments/[attachmentId]`

Deletes the attachment, only when it belongs to the comment in the URL, then its S3 file.

**Response** `200`: `{ "success": true }`. **Error** `404`: Attachment not found.

---

## Match

### `GET /api/match`

Searches external book sources and returns a compact list for matching a record.

**Query parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | yes | Search text |
| `source` | string | no | `all` (default), `isbndb`, `google_books` or `open_library` |

**Response** `200`:
```json
{
  "results": [
    {
      "id": "google_books:abc123",
      "title": "Don Quixote",
      "subtitle": null,
      "authors": ["Miguel de Cervantes"],
      "year": 2003,
      "isbn": "9780142437230",
      "coverUrl": "https://...",
      "source": "google_books",
      "sourceId": "abc123",
      "publisher": "Penguin Classics",
      "pageCount": 1023,
      "language": "en"
    }
  ]
}
```

**Error** `400`: Missing `q`.

---

## Reader

Endpoints for the Calibre e-book reader. `[calibreId]` is the integer Calibre ID.

### `GET /api/reader/[calibreId]/cover`

Streams the book cover from S3. `Cache-Control: private, max-age=604800`.

**Error** `400`: ID is not a number. **Error** `404`: No cover.

### `GET /api/reader/[calibreId]/file`

Streams the book file from S3, inline.

**Query parameters**: `format` (optional): `epub`, `pdf`, `mobi` or `azw3`. Without it, the server takes the first available format in that order.

**Error** `400`: ID is not a number. **Error** `404`: Book or file not found.

### `GET /api/reader/[calibreId]/progress`

**Response** `200`: `{ "progress": { ...reading_progress row } }`, or `{ "progress": null }`.

### `POST /api/reader/[calibreId]/progress`

Saves the reading position.

**Request body** (all fields optional):
```json
{ "cfi": "epubcfi(...)", "page": 42, "progressPercent": 0.35, "currentChapter": "Chapter 3" }
```

`progressPercent` is clamped to 0–1. **Response** `200`: `{ "ok": true }`.
**Error** `400`: Bad ID or invalid JSON. **Error** `404`: Book not found.

---

## Venues

Proxies to the Google Places API (New). Both endpoints need `GOOGLE_PLACES_API_KEY` and return `503` without it. Both return `502` when the Places API fails and `504` when it does not answer.

### `POST /api/venues/search-places`

**Request body**: `{ "query": "bookshop amsterdam", "type": "book_store" }`. `type` is optional.

Rate limit: 10 requests per 10 seconds. Returns at most 8 results.

**Response** `200`:
```json
{
  "results": [
    {
      "placeId": "ChIJ...",
      "name": "The American Book Center",
      "formattedAddress": "Spui 12, Amsterdam",
      "nationalPhoneNumber": "020 625 5537",
      "websiteUri": "https://abc.nl",
      "location": { "latitude": 52.368, "longitude": 4.889 },
      "types": ["book_store"],
      "googleMapsUri": "https://maps.google.com/..."
    }
  ]
}
```

**Error** `400`: Missing query. **Error** `429`: Rate limited.

### `GET /api/venues/place-details`

**Query parameters**: `placeId` (required; letters, digits, `_` and `-`).

**Response** `200`: `{ "place": { ...Places API fields } }`: address, phone numbers, website, location, types, opening hours, business status and rating.
**Error** `400`: Missing or bad `placeId`. **Error** `404`: Place not found.

---

## S3

### `GET /api/s3/read`

Streams a stored image, edition cover or comment attachment from the app's own origin. Only keys under `gold/media/`, `gold/covers/` and `gold/comments/` are served; raw uploads and any other key are refused. Raster images show inline; every other type downloads, with `Content-Security-Policy: sandbox` and `nosniff`.

**Query parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | S3 object key |
| `w` | number | no | Resize to this width (allowed widths only) |
| `v` | string | no | Version: marks the response immutable |

**Response**: `200` the bytes. **Error** `400`: missing key, a key outside those folders, or an unsupported width. `404`: no such object.

---

## Image Adjustments

### `GET /api/image-adjustments.css`

The saved photo adjustments of every edited image, as one stylesheet. The root layout links it on every page. It is not called directly.

**Query parameters**:

| Param | Type | Required | Description |
|---|---|---|---|
| `v` | string | no | Version: the latest `updated_at` in `image_adjustments` plus the row count. A saved adjustment changes it. |

**Response**: `200` `text/css`. One `filter` rule per adjusted image, matched by its `img[src]` URLs. When `v` is the current version, `Cache-Control: public, max-age=31536000, immutable`. Any other `v` gets `Cache-Control: no-store`.

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
