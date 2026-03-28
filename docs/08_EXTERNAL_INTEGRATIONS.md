# External Integrations

Durtal integrates with four external services for metadata enrichment, geocoding, and digital library linking.

---

## Google Books API

**Purpose**: Primary source for book metadata and cover images.

**Client**: `src/lib/api/google-books.ts`

**API**: Google Books API v1 (`https://www.googleapis.com/books/v1/volumes`)

**Authentication**: API key via `GOOGLE_BOOKS_API_KEY` environment variable.

**Rate limits**: 1,000 requests/day on the free tier.

### Functions

#### `searchGoogleBooks(query, maxResults?)`

Free-text search across Google Books.

```typescript
searchGoogleBooks(query: string, maxResults: number = 10): Promise<BookSearchResult[]>
```

Uses `next/fetch` with revalidation every 3,600 seconds (1 hour cache).

#### `searchGoogleBooksByIsbn(isbn)`

ISBN-specific search. Prepends `isbn:` to the query.

```typescript
searchGoogleBooksByIsbn(isbn: string): Promise<BookSearchResult[]>
```

### Response Mapping

| Google Books Field | Durtal Field |
|---|---|
| `volumeInfo.title` | `title` |
| `volumeInfo.subtitle` | `subtitle` |
| `volumeInfo.authors` | `authors` (array) |
| `volumeInfo.publisher` | `publisher` |
| `volumeInfo.publishedDate` | `publishedDate`, `publicationYear` |
| `volumeInfo.description` | `description` |
| `volumeInfo.industryIdentifiers` | `isbn13`, `isbn10` |
| `volumeInfo.pageCount` | `pageCount` |
| `volumeInfo.categories` | `categories` |
| `volumeInfo.imageLinks` | `coverUrl` |
| `volumeInfo.language` | `language` |

Cover image selection priority: `extraLarge` > `large` > `medium` > `small` > `thumbnail` > `smallThumbnail`.

---

## Open Library API

**Purpose**: Secondary/fallback metadata source. No API key required.

**Client**: `src/lib/api/open-library.ts`

**API**: Open Library Search API (`https://openlibrary.org/search.json`)

**Rate limits**: None enforced, but requests should be respectful.

### Functions

#### `searchOpenLibrary(query, limit?)`

Free-text search.

```typescript
searchOpenLibrary(query: string, limit: number = 10): Promise<OpenLibraryResult[]>
```

#### `searchOpenLibraryByIsbn(isbn)`

ISBN-specific search. Sends `isbn:{isbn}` as the query.

```typescript
searchOpenLibraryByIsbn(isbn: string): Promise<OpenLibraryResult[]>
```

### Response Mapping

| Open Library Field | Durtal Field |
|---|---|
| `title` | `title` |
| `subtitle` | `subtitle` |
| `author_name` | `authors` (array) |
| `author_key` | `authorKeys` |
| `publisher[0]` | `publisher` |
| `first_publish_year` | `publishedYear` |
| `isbn[0]` (13-digit) | `isbn13` |
| `isbn[0]` (10-digit) | `isbn10` |
| `number_of_pages_median` | `pageCount` |
| `subject` | `subjects` |
| `cover_i` | `coverUrl` (built as `https://covers.openlibrary.org/b/id/{cover_i}-L.jpg`) |
| `language` | `languages` |
| `edition_count` | `editionCount` |

---

## Search Resolution Chain

When the user searches for a book (via the Add Book wizard or the search API):

1. Both Google Books and Open Library are queried **in parallel**.
2. Results are merged into a unified `BookSearchResult[]` array.
3. Google Books results appear first (richer metadata, better covers).
4. The user selects a result or chooses manual entry.
5. Selected metadata auto-populates the edition form.

If searching by ISBN:
- Google Books: `isbn:{isbn}` query
- Open Library: `isbn:{isbn}` query

If searching by title/author:
- Both APIs receive the raw query string

---

## Nominatim Geocoding

**Purpose**: Address resolution for location management.

**Client**: Inline in `src/app/api/geocode/route.ts`

**API**: Nominatim / OpenStreetMap (`https://nominatim.openstreetmap.org`)

**Authentication**: None required. Uses a `User-Agent` header.

**Rate limits**: 1 request per second (enforced via `setTimeout` throttle in the API route).

### Three Modes

#### Postal Code Lookup

```
GET /search?postalcode={code}&country={countryCode}&format=jsonv2
```

Given a postal code and optional country code, returns matching addresses.

#### Reverse Geocoding

```
GET /reverse?lat={lat}&lon={lon}&format=jsonv2
```

Given coordinates, returns the address at that location.

#### Free-Text Search

```
GET /search?q={query}&format=jsonv2&addressdetails=1
```

General address search.

### Address Parsing

Raw Nominatim responses are parsed into a standardized address object:

```typescript
{
  street: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;  // ISO 3166-1 alpha-2
  postalCode: string;
  latitude: number;
  longitude: number;
  displayName: string;
}
```

The geocode API route supports three location input modes:
- **Manual form**: User types address fields directly
- **Postal code lookup**: User enters postal code + country, API resolves to full address
- **Map picker**: User clicks on a map (Leaflet + Carto Dark Matter tiles), coordinates reverse-geocoded

---

## Calibre-Web

**Purpose**: Deep linking to digital library entries.

**Integration type**: URL linking (no API calls).

**Configuration**: `CALIBRE_WEB_URL` environment variable (e.g., `http://calibre-web:8083` on the Docker network).

When a digital instance has a `calibreId` set, the UI can construct a deep link to the book in Calibre-Web:

```
{CALIBRE_WEB_URL}/book/{calibreId}
```

Calibre-Web handles OPDS and Kobo sync, so Durtal does not replicate those features.

---

## Integration Summary

| Service | Auth | Rate Limit | Used For |
|---|---|---|---|
| Google Books | API key | 1,000/day | Metadata search, cover images |
| Open Library | None | Respectful use | Fallback metadata, cover images |
| Nominatim | None | 1 req/sec | Location geocoding |
| Calibre-Web | Internal network | N/A | Digital book deep links |
