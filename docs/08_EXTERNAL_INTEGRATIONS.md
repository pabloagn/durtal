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

### Book identity records (SLN-464)

The enrichment worker's identity stage reads two Open Library records with its
own client (`src/lib/enrichment/identity-sources.ts`). It does not use
`src/lib/api/open-library.ts`, which reads a failed answer as "not found", so a
429 would look like a missing book.

- The edition record, `GET https://openlibrary.org/isbn/{isbn13}.json`, which
  redirects to the edition. It reads `key`, `title`, `works`, `isbn_13`,
  `isbn_10` and `lccn`, every entry of each list.
- The work record, `GET https://openlibrary.org/works/{OL…W}.json`. It reads
  `key`, `title`, `authors` and `identifiers.wikidata`, the work's Wikidata
  link.

Every call sends the enrichment User-Agent (`src/lib/enrichment/user-agent.ts`)
with the contact in `ENRICHMENT_CONTACT`; without it, the stage does not start.
The calls are one per `--pace` (1,100 ms by default). A 404 is kept in the cache
as "no record". A 429 stops the fetch: nothing of the refused call is cached,
and no job of the run is written.

**Library of Congress: not called.** The read-only sample of 6 Oct 2026 got 403
from loc.gov for every request, so identity makes no loc.gov call. An edition's
LCCN comes from the `lccn` list of its Open Library edition record.

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

## Wikidata (book identity, SLN-464)

The identity stage reaches Wikidata only through `src/lib/wikidata/api.ts`,
which the author and publisher enrichments share. That client now sends the
enrichment User-Agent with `ENRICHMENT_CONTACT`, read at each call, never at
import; it waits out a 429 and lagging servers by itself.

- The query service (`sparqlSelect`, about one query a minute): the items whose
  P648 (Open Library ID) is one of up to 50 Open Library works, as
  `SELECT ?item ?key WHERE { VALUES ?key { "OL…W" … } ?item wdt:P648 ?key . }`.
- `wbgetentities`, 50 items per call: labels and the best-ranked statements of
  P31, P50, P577, P629, P648 and P5331. A redirected item is kept under its
  target's id.
- `searchTerms` (the search generator), five hits, only for a book that no item
  reached through Open Library: the title with `haswbstatement:P50=<author
  QID>`. A book whose authors have no QID gets no search.

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

### Film sources (SLN-376)

| Source | Access | Why | What it has |
|---|---|---|---|
| Wikidata | Looked up (`wikidata-films.ts`) | Documented public API, no key; CC0 data. Images from Wikimedia Commons under each file's license, credited as Commons states it | Titles, first and per-country or festival release dates, countries, original languages, running time, directors, writers, cast (often partial) and crew, production companies, IMDb, TMDB and Letterboxd ids, a poster or still |
| TMDB | Cited by hand | Official API, but it needs an account key, is non-commercial only and asks for its logo and notice ("This product uses the TMDB API but is not endorsed or certified by TMDB"). Durtal has no key | Full billed casts with characters, crew, release dates per country with their type, posters |
| IMDb | Cited by hand | No public API: licensed through a paid service; its datasets are personal and non-commercial under their own terms | Full casts and crews, releases, alternate versions |
| Letterboxd | Cited by hand | API for approved applications only | Casts, crews, releases, members' reviews |

Calls: `wbsearchentities` then `wbgetentities` for a title (items whose P31 is a film class: film, feature, short, television, animated, anime, documentary, silent, adaptation or sequel film); an IMDb `tt` id or a TMDB movie link is found with `haswbstatement:P345=` or `P4947=` through `action=query&list=search`; a Wikidata id or link is read directly. A search also reads the directors' labels, so a hit says "1972 · directed by Andrei Tarkovsky". An item is one `wbgetentities` call, then the labels of its countries (P495), languages (P364), companies (P272), release places (P291 on P577) and people, then characters, 50 ids to a call, at most 400 names, so past that cap a character goes unnamed, never a person. Names are read in English, else in "mul" (the label for all languages, where Wikidata now keeps many names). Countries and release places carry their ISO 3166-1 alpha-2 code (P297), and languages their ISO 639-1 code (P218), else their 639-3 code (P220), read with one `wbgetclaims` call per item and property (four at a time, at most 40 items, the film's countries and languages first), since a country's whole claims run to megabytes; an item whose code does not answer has none. The review matches Durtal's countries and languages by these codes, else by English name, which often differs ("United States" is "United States of America" in Durtal's list) (SLN-551). People come from P57, P58, P161, P162, P344, P1040, P86, P2554 and P2515; a cast keeps its billing order when every member has an ordinal (P1545), characters come from P453 and P4633, and a person listed twice in one role is one credit with both characters. The first release is the earliest P577 that is not deprecated; each P577 is a release, a festival by its place's name, else theatrical. Running time is P2047 in minutes, seconds or hours. The image is P3383 (poster), else P18 (still), with its author and license from Commons' `imageinfo` `extmetadata`; a Commons failure leaves the film without its image. One call a second at most, 20 s each; the perfume and film providers share `src/lib/providers/wikidata.ts` and each sends its own User-Agent, `Durtal personal catalogue (film lookup)` or `(perfume lookup)`, with the `ENRICHMENT_CONTACT` contact inside the brackets when it is set (read at each call).

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

## Research search (SLN-469)

The research agent's stage of the enrichment worker searches for reviews and
publisher pages of a book. It sends only the book's titles, its authors' names,
a translator's surname, the word for "review" in the original language and the
topic words of the research config (`src/lib/enrichment/research/config.ts`).
It never sends a note, a rating, a description, a reading or any e-book text
(R7). It keeps only each result's URL, title and rank: the page is fetched and
stored through the evidence fetcher above, never taken from the provider.
Snippets are off for both providers: neither's terms are recorded here as
allowing a snippet to be stored and passed to a model as text copied from the
page, so a `snippet_only` outlet gives nothing. Every call goes through the cost
meter, with the price table's row (`src/lib/enrichment/prices.ts`), and sends
the enrichment User-Agent. A provider's failure is logged with its name and
HTTP status only, never a URL, key or body.

### Tavily (main)

- **Endpoint:** `POST https://api.tavily.com/search`, `Authorization: Bearer
  <TAVILY_API_KEY>`. `search_depth: "basic"`, `max_results: 10`,
  `include_answer: false`, `include_raw_content: false`, `include_images:
  false`; an outlet query sets `include_domains` (at most 300 domains). The
  answer's `results[].url`, `title` and position are read; its `content`,
  `raw_content` and `answer` are not used.
- **Price and limits** (read on 7 Oct 2026 at
  https://docs.tavily.com/documentation/api-credits): the free Researcher
  plan gives 1,000 credits a month, no card; a basic search costs 1 credit;
  pay-as-you-go is $0.008 a credit. The price row is 0, so trial searches pass
  even at a cap of $0, and still count in the ledger. Before a move to
  pay-as-you-go, the row must become $0.008 a credit, or the cap does not
  count Tavily. The API's own limit is 100
  requests a minute on a development key; the worker paces searches by
  `--pace` (1,100 ms by default).
- **Refusals:** 401 (key), 429 (rate), 432 (key or plan limit) and 433
  (pay-as-you-go limit) make the run move to the fallback; a 5xx or an
  unreadable answer is tried once more first.
- **Check:** `GET https://api.tavily.com/usage`, free, at most 10 calls in 10
  minutes.

### Brave Search (fallback)

- **Endpoint:** `GET https://api.search.brave.com/res/v1/web/search`,
  `X-Subscription-Token: <BRAVE_SEARCH_API_KEY>`, `count` 10, plain text titles.
  Brave has no domain filter: an outlet query adds up to 8 `site:` terms. The
  answer's `web.results[].url`, `title` and position are read.
- **Price and limits** (read on 7 Oct 2026 at https://brave.com/search/api/):
  $5 per 1,000 requests, with $5 of credit a month; the free tier ended in
  early 2026. The price row is $0.005 a request: the meter does not count the
  monthly credit, so it errs high. The plan allows 50 requests a second; the
  worker paces it like the main provider.
- **When:** for the rest of a run once Tavily refuses or fails twice, and once
  for a book Tavily leaves with fewer than two usable candidates (a
  `snippet_only` outlet counts only when its snippet may be stored). Without
  its key the fallback is off and the plan says so. If Brave refuses a book's
  extra pass while Tavily still works, Brave is off for the rest of the run,
  the book keeps Tavily's pages and the run goes on. When both refuse, the run
  stops and the job in hand is held (`quota` or `rate_limited`).
- **Check:** Brave has no free call that proves a key, so the check makes one
  search (`count=1`) through the meter as operation `check`; at the cap it makes
  no call and warns.

## Extraction model (SLN-469)

The extract stage sends the passages of each stored document to one model,
`claude-opus-5-5`, through the official SDK (`@anthropic-ai/sdk`) and one
adapter (`src/lib/enrichment/research/model.ts`). There is no fallback model:
every extraction row and its evidence name the pinned model in their extractor
version, and an answer from another model is invalid.

- **Request:** `messages.create` with the instructions and the vocabulary first,
  as one system block marked for the prompt cache, then one user message with
  the book's titles and authors and the passages. The vocabulary carries each
  term's definition and its applies and does not apply rules, never its
  example books. `output_config.format` is a JSON schema of the current terms
  (from zod 4's `z.toJSONSchema`, checked again with zod), and
  `output_config.effort` is `low`: this model refuses `temperature`, and its
  thinking cannot be turned off. No tools and no prefill. `max_tokens` is
  4,000.
- **Answer:** valid only when it ends on its own (`stop_reason` `end_turn`)
  and parses against the schema. A refusal (`refusal`) or a cut answer
  (`max_tokens`) is an `invalid_answer` row and never a claim.
- **Price** (read on 7 Oct 2026 at https://www.anthropic.com/pricing): $4 per
  million input tokens, $20 per million output tokens, $0.20 per million
  cache reads and $5 per million cache writes (5-minute TTL). About $0.50 a
  book; the ceiling `maxCostPerWork` is $1.50.
- **Meter:** each call reserves the free token count
  (`messages.countTokens`) plus the full output cap, then settles at the four
  units the answer reports. Its answer is kept in the run's cache by request
  hash before its rows are written, so a failed write does not pay twice.
- **Refusals:** 401 and 403 hold the job (`quota`), 429 holds it
  (`rate_limited`); neither is billed. Another failure fails the job.
- **Check:** `models.retrieve("claude-opus-5-5")`, free.

---

## Integration Summary

| Service | Auth | Rate Limit | Used For |
|---|---|---|---|
| Google Books | API key | 1,000/day | Metadata search, cover images |
| Open Library | None | Respectful use | Fallback metadata, cover images |
| Nominatim | None | 1 req/sec | Location geocoding |
| Wikidata (perfumes) | None | 1 req/sec | Perfume identity lookup, reviewed before saving |
| Wikidata and Wikimedia Commons (films) | None | 1 req/sec | Film lookup with cast, crew, releases and poster, reviewed before saving |
| Open Library and Wikidata (book identity) | None; User-Agent with `ENRICHMENT_CONTACT` | Open Library 1 per 1.1 s; Wikidata 1 per 2 s, the query service about 1 a minute | The enrichment worker's identity stage (SLN-464); loc.gov is not called |
| Art Institute of Chicago, The Met | None | 1 req/sec | Painting and original lookup; location only from "on view" |
| Evidence outlets (review and publisher sites) | None | 1 request per 5 s per host, or its crawl delay | Book enrichment evidence, robots.txt and terms honoured |
| Tavily | `TAVILY_API_KEY` | 100/minute; 1,000 free searches a month | The research agent's main search (SLN-469) |
| Brave Search | `BRAVE_SEARCH_API_KEY` (optional) | 50/second; $5 per 1,000 | The research agent's fallback search (SLN-469) |
| Anthropic | `ANTHROPIC_API_KEY` | The key's tier; $4 and $20 per million input and output tokens | The research agent's extraction model (SLN-469) |
