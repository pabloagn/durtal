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

## Provider Contract

Metadata providers for perfumes, films and paintings meet one contract (SLN-375, `src/lib/providers/`). The book searches above keep their own code.

- **Scope**: a provider serves one collection and names the record levels it describes: `work` and `edition` for books, `work` and `formulation` for perfumes, `work`, `version` and `release` for films, `work` and `art_object` for paintings. It declares the fields it may propose for each level.
- **Calls**: `search` (a query for one level), `detail` (one item by the provider's id) and `normalize` (pure: a detail becomes proposed values). `searchProvider` and `fetchProviderDetail` in `run.ts` make every call: each waits at most the provider's time limit, calls to one provider keep the gap its terms ask for, and an answer is checked before anything reads it. A `429` answer is reported as rate limited. Results past the provider's limit are dropped, and so are results the contract cannot read.
- **Review**: `recordProviderDetail` registers the provider's id (provider, kind and id are unique) and keeps the detail as a pending source observation. It changes nothing on the record. `reviewProposal` fills only empty fields: a field that has a value, a field the person locked and every field of a locked record (a locked observation of this provider, or locked edition metadata) come back as conflicts for the person to settle.
- **Registry**: `src/lib/providers/registry.ts` lists the providers this Durtal may call, each permitted by its own documented terms; none is a scraper. Catalogue writes, imports and exports never import a provider (a test checks this), so manual entry is complete without one. Only the source lookup actions call providers.

### Perfume sources (SLN-377)

| Source | Access | Why | What it has |
|---|---|---|---|
| Wikidata | Looked up (`wikidata-perfumes.ts`) | Documented public API; CC0 data | Name, brand, manufacturer, perfumers and launch date of well-known perfumes. No notes, no concentrations, few recent or niche releases |
| Fragrantica | Cited by hand | No public API; Durtal does not read its pages | Notes, perfumers, launch years, concentrations |
| Basenotes | Cited by hand | No public API; Durtal does not read its pages | Notes, perfumers, launch years |
| Parfumo | Cited by hand | No public API; Durtal does not read its pages | Notes, perfumers, launch years, batch codes |

Not used: Open Beauty Facts (an open product database by barcode; it names products and sizes, rarely the fragrance), and house websites (cited by hand like any page).

### Museum sources (SLN-378)

| Source | Access | Why | What it has |
|---|---|---|---|
| Art Institute of Chicago | Looked up (`artic`) | Documented open API, no key; CC0 data, public-domain images | Title, attribution, date, medium, size in cm (`dimensions_detail`), reference number, credit line, `is_on_view` and gallery, IIIF image |
| The Met | Looked up (`metmuseum`) | Documented open API, no key; CC0 data, public-domain images | Title, attribution, date, medium, size in cm (`measurements`), accession number, credit line, gallery number when on view, image |
| Cleveland Museum of Art | Cited by hand | Open API without a key, not connected yet | Its collection, with the current gallery |
| Rijksmuseum | Cited by hand | Its API needs a personal key | Its collection |
| Smithsonian Open Access | Cited by hand | Its API needs an api.data.gov key | The Smithsonian collections |
| Wikidata | Not for paintings | Collection and location statements carry no dates | Owning collections, inventory numbers |

Calls: the Art Institute's `GET /api/v1/artworks/search` and `GET /api/v1/artworks/{id}` with the fields Durtal reads and an `AIC-User-Agent` header (60 requests a minute anonymous); the Met's `GET /public/collection/v1.1/search` with `offset` and `limit` (v1/search was retired on 2026-10-01; ids only, so up to eight objects are read for a result list) and `GET /public/collection/v1/objects/{id}`. One call a second at most per museum. An Art Institute work without `is_on_view` is "does not say"; a Met object with an empty gallery number is "not on view". Neither answer says where an object is when it is not shown, so neither ever moves it. The institution is matched to Organizations by its Wikidata id (Art Institute Q239303, The Met Q160236), then by one exact name.

Wikidata calls: `wbsearchentities` then `wbgetentities` for a search (items whose P31 is Q131746, perfume), and `wbgetentities` for an item and the labels of its brand (P1716), manufacturer (P176) and perfumers (P14539); the launch date is P571, else P577, at its own precision (a decade is a range). One call a second at most, 12 s each. A brand is proposed as a brand and a manufacturer as a manufacturer, never as each other.

---

## Evidence fetcher (SLN-468)

The book enrichment fetches review and publisher pages as evidence through
`createPageFetcher` (`src/lib/net/safe-fetch-page.ts`), never through plain
`fetch`. It shares the guarded request loop of `safeFetchImage`: every resolved
address is checked when the socket connects, redirects are followed by hand and
checked again, one deadline counts network time (30 s), and the body is capped
while it streams (5 MB). HTTPS only; HTML, XHTML or plain text only (a PDF fails
as `unsupported_type`).

- **Allowlist.** Only a URL of an active outlet of the registry
  (`evidence_outlets`, docs/02) whose policy is `fetch`; every hop is checked
  again, so a redirect off the registry fails as `off_registry`.
- **Blocked hosts.** `goodreads.com`, `thestorygraph.com` and their subdomains
  are refused in code, before any network call, whatever the registry holds.
- **robots.txt** (RFC 9309, parsed by `src/lib/net/robots.ts`): read once per
  host and cached for 24 hours, following up to 5 redirects. The groups that
  name `DurtalBot` win, else `*`; the longest matching path wins, `Allow` on a
  tie. A 4xx (other than 429) means no rules; a 5xx, a 429 or no answer skips the
  host for the run. `Crawl-delay` is respected, and a host that asks for more
  than 60 s is skipped.
- **Pacing.** One request at a time per host, at least 5 s apart (or the
  crawl delay); robots.txt counts as the first request. A 429 or 503 with a
  `Retry-After` of at most 120 s waits once; a longer wait or a second refusal
  skips the host for the run. Another 5xx or a network error is tried once
  more.
- **Manners.** The User-Agent is `DurtalBot/1.0 (personal book catalogue;
  <contact>)` with the contact from `ENRICHMENT_CONTACT`; without it the fetcher
  refuses to start. No cookie, login, `Authorization` or `Referer` header; a
  401, 402 or 403 fails as `paywall_or_login` and is never retried; no archive
  or cache copy; no page script runs.

Every refusal has a typed reason for the run report (`EVIDENCE_FETCH_REASONS`).
Search providers, model calls and their costs are metered by the cost meter
(docs/02); page fetches and free official APIs are not.

---

## Integration Summary

| Service | Auth | Rate Limit | Used For |
|---|---|---|---|
| Google Books | API key | 1,000/day | Metadata search, cover images |
| Open Library | None | Respectful use | Fallback metadata, cover images |
| Nominatim | None | 1 req/sec | Location geocoding |
| Wikidata (perfumes) | None | 1 req/sec | Perfume identity lookup, reviewed before saving |
| Art Institute of Chicago, The Met | None | 1 req/sec | Painting and original lookup; location only from "on view" |
| Evidence outlets (review and publisher sites) | None | 1 request per 5 s per host, or its crawl delay | Book enrichment evidence, robots.txt and terms honoured |
