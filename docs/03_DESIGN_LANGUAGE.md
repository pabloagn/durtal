# Design Language

Dark-mode only. Gothic-minimal aesthetic. The interface should feel like it belongs alongside Linear and a personal website built with obsessive typographic care — dark, precise, quietly unsettling.

No light mode. No theme toggle.

---

## Philosophy

The interface should feel like browsing a private library in a dimly lit study — sophisticated, quiet, precise. The aesthetic draws from Linear (information density, keyboard-first), Sacred Computer (dark minimalism, typographic hierarchy), and Serge Lutens (underlying strangeness beneath extreme polish). Not a replica of any. A synthesis.

Information density is high, ornamentation is absent, and every pixel earns its place. The palette is desaturated and muted — no bright neons, no saturated primaries. Color appears sparingly as accent, never as decoration.

---

## Color Palette

### Quiet Glass palette

Approved in SLN-556. Neutral ink, charcoal and smoke, with muted steel interaction and restrained aged gold. Artwork keeps its original colours. Actual colour taxonomy is data and does not inherit the theme.

| Token | Value | Role |
|---|---|---|
| `bg-primary` | #07090D | Page canvas |
| `bg-secondary` | #0E1319 | Content surface |
| `bg-tertiary` | #171E26 | Raised/hover surface |
| `fg-heading` | #D8DCD8 | Page headings |
| `fg-primary` | #C5CACB | Body text |
| `fg-secondary` | #9BA4AD | Labels, metadata, needed secondary text |
| `fg-muted` | #727B83 | Decoration, placeholders and disabled content |
| `accent-primary` | #8C9FAE | Interaction, focus, links |
| `selection-bg` / `selection-fg` | #17232D / #D8DCD8 | Selected regions |
| `action-fill` / `action-hover` | #C5CDCF / #D4DADB | Main confirmation |
| `action-fg` | #10151A | Text on silver actions |
| `border-subtle` | #252E37 | Decorative separator |
| `border-control` | #687987 | Essential control boundary when required |
| `accent-underlay` | #1C2A35 | Restrained petrol depth |
| `accent-gold` | #AFA184 | Ratings and rare marks |
| `accent-sage` | #A3AE9C | Success |
| `accent-red` / `accent-red-text` | #C4746E / #D18B82 | Destructive state / readable error text |
| `accent-blue` / `accent-blue-text` | #8C9FAE | Information |
| `accent-slate` | #687987 | Decorative secondary accent |

All tokens have the `--color-` prefix in CSS. Named roles replace the old rose/plum/crimson theme. Status still has a label or icon; colour is supplementary.

**Contrast.** Needed text is at least 4.5:1 (3:1 for qualifying large text). Secondary text is at least 6.65:1 across the three opaque surfaces. `fg-muted` is reserved for decoration and disabled content. Use `scripts/qa/design-audit.js`, then separately inspect pixels over glass and imagery: a DOM audit cannot fully measure the composited backdrop. Essential state indicators or boundaries meet 3:1; decorative panel edges need not.

### Artwork, atmosphere and gradients

Keep book covers, posters and paintings truthful. The header's cover-derived crystalline gradients remain, attenuated to 38% of their prior opacity with 60% saturation and the existing bounded fade. Missing palettes fall back to ink/petrol/steel. Cached warm palettes are attenuated at render time; no recolouring or live-data rewrite.

Use gradients for artwork atmosphere, timeline depth and image scrims where they clarify layering. Do not add bevels, bright rims, metallic reflections or gradient primary buttons. Body content remains on quiet opaque ink surfaces.

Small image controls use `glass-chip`; adjacent book-card actions share `artwork-actions`, one tray with individually highlighted controls. Larger image layers use `overlay` (85% page ink), `scrim` (70%) and `scrim-deep` (90%). No `bg-black` or `text-white`. Labels stay opaque and use `fg-primary`; glass chip icon tones are mixed with foreground for readability.

---

## Typography

Four font families serve distinct roles:

| Role | Family | Weight | Fallbacks | Character |
|---|---|---|---|---|
| **Serif (display)** | PP Cirka | 300 (Light); 700 available | Georgia, serif | Headings, titles, stat numbers: sharp, literary, never bold |
| **Serif (text)** | EB Garamond | 400, with true italic | Georgia, serif | Long reading text only (`type-prose`): old-style figures, made for paragraphs |
| **Sans** | Inter | 400 | Work Sans, system-ui, sans-serif | Clean, readable, modern |
| **Mono** | JetBrains Mono | 400 | IBM Plex Mono, SF Mono, monospace | Metadata a reader scans or compares: years, counts, dates, prices, ISBNs, codes, key hints, and the `type-caption` labels |
| **UI Chrome** | Inter | 500 | system-ui, sans-serif | Buttons, navigation |

Headings are deliberately normal weight — understated. Boldness is used sparingly for emphasis, never as default.

### Font Loading

The root layout (`src/app/layout.tsx`) loads three families on every page:

```typescript
const serif = localFont({ src: [/* PPCirka-Light.otf 300, PPCirka-Bold.otf 700 */], variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```

EB Garamond is declared in `src/components/shared/prose.tsx` (`--font-prose`), not in the layout, so it loads and preloads only on routes that render `<Prose>` (the book, author, series and collection pages). Its Latin files are preloaded; other scripts load only when a text needs them.

CSS custom properties (`--font-serif`, `--font-sans`, `--font-mono`) are set via Tailwind's `@theme` block, allowing usage throughout as `font-serif`, `font-sans`, `font-mono` utility classes.

### Scale

Seven sizes, defined in `src/styles/globals.css`. Tailwind's own sizes are cleared, so no other size class exists (`text-base`, `text-xl`, `text-5xl` and `text-[13px]` generate nothing).

| Class | Size | Use |
|---|---|---|
| `text-micro` | 12px | Captions, chips, timestamps, keyboard hints |
| `text-xs` | 14px | Metadata, field labels, small UI text |
| `text-sm` | 16px | Body text, controls |
| `text-lg` | 21px | Card and item titles, field group titles |
| `text-2xl` | 30px | Section titles |
| `text-3xl` | 38px | Stat numbers |
| `text-4xl` | 46px | Page titles |

### Roles

A heading never picks its own size and color: it uses its role. Each role sets family, size, line height, tracking and color.

| Role | Look | Use |
|---|---|---|
| `type-page-title` | Serif 46px, tight tracking, heading | The h1 of every page (`PageHeader`) |
| `type-section-title` | Serif 30px, primary | Every titled block on a page, through `SectionHeading` |
| `type-item-title` | Serif 21px, line height 1.375, primary | Card titles, the title of a block inside a section, empty and error states |
| `type-group-title` | Sans 21px, secondary | A group of fields in a form or dialog |
| `type-stat` | Serif 38px, tight tracking | The number in a stat tile |
| `type-dialog-title` | Sans 16px, medium, heading | Functional dialog title |
| `type-label` | Sans 14px, medium, secondary | The label above a form field |
| `type-caption` | Mono 12px, uppercase, 0.05em, secondary | Eyebrows, stat and column labels |
| `type-prose` | EB Garamond 21px on 32px lines, primary, old-style figures, at most 26em (about 65 characters) | Long reading text: book descriptions, bios, collection and series descriptions. Use `<Prose>` (`src/components/shared/prose.tsx`), which loads the font |

`SectionHeading` (`src/components/shared/section-heading.tsx`) is the only way to title a block on a page: title, optional count, icon, description and action, with 16px below. A block inside a titled section (a row of cards under "Perfumes") uses `SectionHeading` with `as="h3"`, which takes `type-item-title`; `HorizontalCarousel` passes `as` through. Sections are 32px apart (`mb-8`). Body and metadata text use the scale directly (`text-sm`, `text-xs`). Long reading text never uses the body size: it uses `<Prose>`.

---

## Spatial System

### Spacing Scale

```
--space-xs:     4px
--space-sm:     8px
--space-md:     16px
--space-lg:     24px
--space-xl:     32px
--space-2xl:    48px
--space-3xl:    64px
```

### Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-none` | `0px` | No rounding |
| `--radius-sm` | `4px` | Default for buttons, inputs, cards |
| `--radius-md` | `6px` | Modals, larger containers |
| `--radius-lg` | `8px` | Reserved (rarely used) |
| `--radius-full` | `9999px` | Pills, avatars |

Corners are subtly softened: 4px controls and 6px floating surfaces. Avoid pill-shaped controls; circles remain appropriate for avatars and status dots.

### Glass

One shared smoked-glass material for floating surfaces. Underlying shapes visibly diffuse through it; foreground content stays opaque. Separation comes from tint, blur and shadow, with one faint, even boundary.

| Layer | Value |
|---|---|
| Tint | `glass-tint`: rgba(14,18,23,0.70) |
| Backdrop | 24px blur, 65% saturation, 55% brightness |
| Edge | rgba(210,220,228,0.07), even on all sides |
| Corners | 6px (`radius-md`) |
| Depth | Soft contact, floating and ambient shadows |

No sheen, bright top line, bevel or inset highlight. If blur is unavailable or reduced transparency is requested, use opaque `bg-secondary`. Validate over warm, cool, bright and dark imagery; the material must diffuse shapes and preserve readable text.

**Where it goes:**

| Surface | Utility |
|---|---|
| Command palette, leader menus (A, G, Y, E, R), dialogs | `glass`, with `glass-veil` behind (`backdrop:glass-veil` on a `<dialog>`) |
| Menus, select lists, date picker, filter panels, pickers (also films' search picker), hover cards | `glass` |
| Tooltips | `glass` |
| Selection toolbars | `glass` |
| A bar fixed to a screen edge: the navigation bar on a phone, the sidebar (a drawer over the page on a phone), the reader's toolbar and progress bar | `glass-bar`: the same material, square corners, no shadow, a border only on the side facing the page |
| A small control or mark on an image | `glass-chip`: 72% ink tint, 12px blur (smaller for cover marks), 65% saturation and brightness, no visible border or inset shadow. `artwork-actions` groups adjacent controls in one 4px tray. Hover lifts only the target control; touch targets are 44px. |
| What lies behind the phone drawer | `glass-veil` |

`glass-veil` is the layer behind a modal surface: the page at 48% ink, blurred 4px, so it stays in view but steps back.

In CSS, write `-webkit-backdrop-filter` before `backdrop-filter`. In the other order, Lightning CSS (Turbopack, Tailwind) reads the prefixed line as an override, drops the standard line, and Chrome shows no blur. `src/__tests__/glass-surfaces.test.ts` checks the order.

**How to use it.** Add the `glass` class to the floating element itself (`glass-bar` for a bar fixed to a screen edge), also on a native `<dialog>` or a cmdk list. The element needs a position and no background or border of its own; a `<dialog>` also takes `border-0 bg-transparent` against the browser's defaults. The material sits on a `::before` layer: a backdrop filter on the element itself would trap its `position: fixed` children, such as a picker inside a dialog.

**A glass surface never scrolls.** The `::before` layer would scroll away with the first screenful and leave the rest of a long list on the bare page. The glass element takes `overflow-hidden`; an element inside it scrolls (`max-h-56 overflow-y-auto` on a select's list). A dialog's body scrolls, not the dialog, so its header stays in view. `src/__tests__/glass-surfaces.test.ts` checks it.

**Never** on page content: cards, panels, sections, tables and the record column stay opaque (`bg-secondary`). The controls and marks on a card's image are `glass-chip`.

---

## Component Patterns

### Book Cards

- Dark background (`bg-secondary`)
- Cover image with no border radius
- Subtle 1px border in `bg-tertiary`
- Hover: a quiet surface lift and restrained petrol shadow, without a coloured rim
- The cover shows its art. Only the marks that make a copy special sit on it: rare, poison and digital edition, as one cluster in the bottom-left corner. Their chips (`src/components/books/cover-chip.ts`) share one size and inset and the shared `glass-chip` material, so they read on white and on black covers alike. Controls on a cover (the actions menu, copy, image adjustment) show on hover and keyboard focus, and always on a touch screen, which has no hover (`hover-reveal` in `globals.css`).
- Text uses `CardHeading`: 21px Cirka titles and full-width 16px Inter identifying metadata. Titles take their natural height and metadata sits 4px below the last title line. Metadata reserves a minimum line but never clamps; longer text grows naturally. The favourite action floats beside only the first title line; it never narrows the metadata column. Ordinary words wrap at spaces; an exceptionally long unbroken token may wrap to prevent overflow. Essential names never require hover to read.
- Catalogue grids treat density as a maximum column count and keep at least 208px per card including its padding. Below that available width, one card fits the container. Related shelves use container-relative 208–256px cards instead of fixed 160px thumbnails. Cards stretch to the tallest item in their row, and flexible bodies align footer metadata at the bottom without clipping titles. Horizontal overflow belongs to the shelf, never the page. Height remains content-driven, including in short viewports.
- Info row, in secondary text: the status as a colored dot and its label (`CardStatus`; the tooltip adds the priority and the number of copies), the language from 200px card width, then on the right the rating (a gold star and the number, `CardRating`, from 160px) and the year (from 160px; 220px beside a rating). The status always fits whole.

### Work cards

Every work card, whatever its collection, is cut like a book's card (`src/components/shared/work-card.tsx`): the picture's frame, then `CardHeading` (naturally wrapping titles and people), then the info row (`WorkCardInfo`): the status on the left, the rating and the year, or the collection's own date, on the right. The status is a book's: films, perfumes and paintings have none yet, so their row holds the rating and the date. So a row that mixes collections reads as one family: artwork and title starts align, and footer rows align at the bottom. Long text remains fully visible.

- Film, perfume and painting cards keep their collection's frame in their own grids and rows: the poster, the bottle's square, the picture's frame. A chip on the frame counts what is held.
- Where collections mix in one row (the dashboard's recent additions), every card has the book cover's 2:3 frame. `WorkCardArt` contains the picture whole and centered; a blurred, dimmed copy of it fills the bands, like frosted glass behind it. Without a picture, the collection's stand-in (a flacon, a monogram) fills the frame.
- Why a card is in a related row ("With Kurt Russell", "Shares iris, vanilla") goes under the card, on naturally wrapping lines, as under a book's card.

Author, series, collection and dashboard cards follow the same layout. Author cards: name, nationality, then the years and the number of books. Series cards: title, original title, then the counts and "Complete" in gold. Collection cards: the complete name with its icon, a description preview limited to two lines, then the edition count. Descriptive prose is not identifying metadata: keep its preview bounded so long descriptions cannot stretch an entire row; the collection detail page displays the full description. No count or status sits on a portrait or a cover.

### Mosaic

A view of the pictures alone: no card, no text, no chips (`<Mosaic>`, `src/components/shared/mosaic.tsx`; `mosaic*` utilities in `globals.css`). Every list with posters offers it beside the grid: books, people, films, perfumes, paintings and collections, and the choice is kept like the other views.

- Justified rows: each picture keeps its own proportions (a painting is not cropped to a poster), every picture of a row has one height, and every row but the last fills the width, in reading order. A full row holds the size slider's value plus two pictures of the list's usual proportions, or fewer where they would be under 150px tall (a phone). The last row has the height of a full row; it does not stretch.
- 4px between pictures, 4px corners, a hairline edge; each picture over its own tone while it loads, and the list's own stand-in (a title card, a monogram, a fan of covers) when there is none.
- Hover: the picture eases forward (4%) and its title, and the author or house under it, appear at its foot on glass; the other pictures dim to 62%. Keyboard focus shows the title and a steel focus ring. In selection mode a click selects; a selected picture has a steel focus ring. A right-click opens the browser's menu for the link, not for the picture, so pictures stay protected.

### Buttons

Four variants, using the shared `Button` / `buttonClass`:

| Variant | Treatment | Use |
|---|---|---|
| Primary | Flat `action-fill`, dark `action-fg`; hover `action-hover` | Main form/dialog confirmation |
| Secondary | Neutral `glass-highlight`, no outline | Quiet ordinary actions, including Add book |
| Ghost | Transparent, neutral hover | Utility actions, including Identify editions |
| Danger | Subtle red tint, readable red text | Destructive actions |

Fine-pointer heights are 28/32/36px for sm/md/lg, with 14px labels, 6px gaps and 10/12/14px horizontal padding. All use 4px corners. Coarse-pointer controls grow to at least 44px. Preserve a separate steel keyboard-focus outline; no bevels, coloured rims or glow.

| Size | Use | Icon-only utility |
|---|---|---|
| sm · 28px | Dense edition/copy rows, selection toolbars, dialog header controls, cover overlays | `action-icon-sm`; overlays use `chip-button glass-chip` |
| md · 32px | Entity headers and ordinary secondary action rows; use md for labelled actions beside md icons | `action-icon` |
| lg · 36px | Roomier standalone confirmations, never a utility menu beside smaller controls | Use a labelled `Button` |

`action-control` supplies shared alignment, 4px corners, transitions, disabled opacity and an inset steel focus outline that survives a cap box or glass edge. `action-ghost` supplies the quiet utility surface: transparent at rest, a neutral highlight on hover/menu-open and a subdued active fill. The ellipsis has no persistent box or border; it stays at its row's hierarchy. Favourite controls keep their gold mark and the same neutral surface states. Interface action icons are 16px with 1.5px strokes, including Copy, Collection and Export. Cover controls keep the restrained glass material and 28px visible desktop scale.

Keep neighbouring targets separate: each icon utility grows its actual box to 44 × 44px on touch, and labelled buttons grow to at least 44px high/wide. Do not add `touch-hit` to these growing controls. Use 8px between header actions, 4px in dense edition/dialog rows, and `CapAlignedControls` (with the matching height and `coarseHeight={44}`) beside titles. Rows wrap whole controls when labels need room; preserve the cap center and avoid clipping focus. Hover, focus, active/menu-open, pressed and disabled states must not change padding, borders or dimensions. Export keeps its label and swaps a same-size busy icon to avoid shifting the row. Sidebar/navigation geometry and dropdown content spacing have their own guidance.

### Inputs and dialog chrome

Default fields use a faint neutral boundary, 4px corners and a visible steel focus outline. Labels remain persistent. Text-entry controls use 14px text on desktop and at least 16px on touch. `Input appearance="open"` removes the redundant background/border from title entry while keeping its label and focus treatment.

Functional dialog titles use `type-dialog-title` (Inter 16px, medium); form group titles use Inter. Literary page headings remain Cirka and prose remains Garamond. Shared dialogs remove the heavy header divider and group fields by spacing.

### Filters

A list's filters open from the Filter button in a `glass` panel (`FilterDropdown`, `src/components/shared/filter-dropdown.tsx`). The panel never scrolls; its parts do.

- **Groups**: a `type-caption` heading with a count badge of its chosen values, then its options. An option is a 14px box (ink selection when chosen) and its label; a count of books sits at the right in 12px mono, `fg-secondary`. A list of 8 options or more has its own search.
- **Sections** (the library, SLN-405): many groups go in sections. A rail on the left lists them, each with its count badge; the chosen section's groups show beside it, all open. The panel is 34rem wide (the window less 32px on a phone) and keeps one height, so it does not jump between sections. It hangs from the button and moves sideways to stay 16px inside the window.
- **Colour swatches**: a colour group shows its options in two columns, each with a 14px swatch (2px radius, `glass-border` edge) in place of the box. A chosen swatch takes a check in the ink that reads better on it (`inkOn`) and an `fg-primary` edge. A colour nothing has stays in its place at 40% and cannot be chosen. Swatch colours are muted like the rest of the palette (`COLOR_BUCKETS`, `src/lib/color/color-buckets.ts`).
- **Active filters**: under the filter bar, one chip per chosen value (`ActiveFilters`): `bg-secondary`, a `glass-border` edge, 28px high (44px on a touch screen), the group in `fg-secondary`, the value in `fg-primary`, a 12px X. The whole chip removes its filter; "Clear all" in steel text ends the row. These chips are page content, so they are never glass.

### Ratings

A work's rating is 0.5 to 5 in half steps, the same for books, films, perfumes and paintings (venue ratings are another scale). One component shows and edits it (`src/components/shared/rating.tsx`); the number is written by `formatRating` (`src/lib/utils/rating.ts`): "4" or "4.5", never "4.0".

- `RatingStars`: five Lucide stars at 1.5 stroke, 2px apart, 12px in rows, 14px in a header, 16px at most. Filled parts are `accent-gold`; a half star fills its left half (the gold star clipped at its middle). Empty stars and halves are outlined in `fg-secondary`, never `fg-muted`. Read as "Rated 4.5 out of 5" or "Not rated". It is one small SVG with the star path once (SLN-448), so a list of 48 ratings stays light; it draws the same pixels as five separate icons.
- `RatingInput`: a slider ("4.5 stars", or "Not rated" at 0). With a mouse each star is a 24px target split in two: the left half sets n - 0.5, the right half n, hover previews, and choosing the current value clears it. On touch (by the event's pointer type) the stars are 44px whole-star targets: a tap sets n, a second tap on the same star n - 0.5, a third n again; a drag previews half steps and sets on release, and the row lets the page scroll vertically. A "Clear" button follows the stars on coarse pointers when a value is set; its space is kept so the row does not shift. Keys: Left and Down step down to 0.5, Right and Up step up (from Not rated to 0.5), Home 0.5, End 5, Backspace and Delete clear, 1 to 5 set whole stars. It sits on the cap-height center of the text beside it (`CapAligned` with `coarseHeight`).
- Beside stars, a short number ("4.5"); a badge keeps "4.5/5".

### Tables

- Clean rows with alternating subtle backgrounds
- No heavy borders
- Serif column headers
- Row hover with `bg-tertiary`

### Modals (Dialogs)

- Centered on screen
- Glass (`glass`), over the veil (`glass-veil`): the page stays in view, dimmed and softly blurred
- 4px corners, the glass edge and its shadow
- The header stays in view; the body scrolls when the dialog reaches 90% of the screen height
- Backdrop clicks close the modal
- A dialog whose lists load as it opens (`OptionsNotice`, `src/components/shared/options-notice.tsx`, SLN-510) shows the chosen items in them at once and never an empty list. A load under 200 ms shows nothing; a longer one puts "Loading the lists…" in 12px `fg-secondary` at the footer's start, beside the buttons, so nothing moves. A failed load puts "Could not load the lists." in `accent-red-text` there, with Retry. An empty list section says "Loading…" until its list arrives, or "Not loaded" after a failed load, never "No themes available"

### Badges

Multiple semantic variants:

| Variant | Background | Text |
|---|---|---|
| **Default** | `bg-tertiary` | `fg-primary` |
| **Muted** | `bg-tertiary` | `fg-secondary` |
| **Blue** | `accent-blue/20` | `accent-blue` |
| **Gold** | `accent-gold/20` | `accent-gold` |
| **Sage** | `accent-sage/20` | `accent-sage` |
| **Red** | `accent-red/20` | `accent-red` |

### Empty States

- Centered layout
- Serif title text, muted
- Brief description
- Single action button
- No illustrations, no emoji

### Toasts

Sonner toast notifications. Appear at bottom-right. Dark theme matching the application palette. On a phone (600px and narrower) they span the screen between 16px margins (`globals.css` keeps Sonner's list inside the screen).

### Detail pages

A book, author or place page has three parts (`src/components/shared/detail-layout.tsx`):

- The header: image, title, the key facts and the actions.
- `DetailColumns`: the reading column (description, notes, editions, books) and, from `lg` up, an 18rem record column on the right: one `RecordPanel` of `RecordGroup`s (Details, Taxonomy, Media, Orders, Links, Contact), with caption titles and label-over-value `RecordField`s. Below `lg` the record follows the reading content.
- Full-width rows: related books, gallery, activity.

A publisher page follows the author page: the house's banner behind the header and its logo beside the name. A logo is never cropped: it sits whole on a dark tile (`object-contain`), on the page and on the publisher cards. Publisher images keep their colours (the monochrome rule is for people only). Its books are book cards with this house's edition covers, filtered, sorted and paged like the library.

A section or group with nothing to show is left out; its "Add" action lives in the page's actions menu.

### Images of people

Every image of a person is monochrome: the portrait, the background banner and its backdrop, gallery images, and every thumbnail that cards, lists, carousels, timelines, hover cards and the command palette show. No exceptions, for every role (writers, translators, directors, actors, perfumers, painters). The server stores the shown files in monochrome; image adjustments cannot bring colour back (saturation, grayscale and sepia are locked). Book covers, film posters, perfume and painting images, publisher logos and collection posters keep their colours.

### Cards without a photo

A card never shows an empty box. `src/components/shared/no-photo.tsx` holds one family of placeholders, on the dark frame with a faint tint:

- Author with books: up to three of their covers, fanned (`CoverFan`). Author with no books: initials in the serif (`Monogram`).
- Place: a label with its kind and city in small capitals, a rule, and its street in the serif (`PlacePlate`).
- Series with no book yet: a shelf of spines, one per known volume (`ShelfSpines`).
- While an image loads, its frame shows the poster's main color, dimmed, and the image fades in (`FadeImage`, `coverToneStyle`).

### Reading timer chip

The one running reading timer shows in a chip (`src/components/reading/timer-chip.tsx`, SLN-451). The chip is not glass: it sits inside the sidebar or the phone bar's `glass-bar`. Its popovers and menus are `glass` with `overflow-hidden`. The reader view (`/reader/[id]`) shows no chip.

| Where | Layout |
|---|---|
| Expanded sidebar (footer) | Cover thumb (blank when the book has no cover: an icon there would sit beside the time off its cap height), the time ("12:04"), the title (`lines-1`), Pause or Resume, and Stop |
| Icon rail (56px: a collapsed sidebar, and always from 768 to 800px) | The time above one 44px Stop button. The time opens a menu with the title, Pause or Resume, and Discard; its tooltip names the book |
| Phone bar (below `md`) | The time and Stop only, between the name and Search, each at least 44px like the bar's buttons: the time, which opens the same menu, in `CapAlignedControls height={44}`, Stop in `CapAligned height={44}` |

- The time uses `tabular-nums`, so its width never jitters. A paused timer shows its time in `fg-secondary` and says "Paused" to screen readers. The ticking time is not a live region.
- The chip's accessible name reads "Timer for Nadja, 12 minutes". Each icon-only button has an `aria-label` and a tooltip: "Pause timer", "Resume timer", "Stop timer".
- After the check time in Settings → Reading, the chip reads "Still reading?". It never turns red: no estimate or timer scolds.
- An estimate's info button opens a glass popover (a native `popover`, so cards that clip do not cut it).

### Goals and the reading rhythm

Goals and the rhythm never nag (SLN-455): no word says "behind", "lost" or "failed", nothing is red, nothing counts a streak, and nothing sends a notification. `NEVER_SAID` (`src/lib/reading/goals.ts`) lists the words a test keeps out.

- **A goal card** (`src/components/reading/goal-card.tsx`): "12 of 30 books" in the item title role with an info button at its right (`CapAligned`), a sage `ProgressBar`, and one neutral line in 12px `fg-secondary`, at least two lines tall, expanding when the text needs more room: "On pace", "2 books ahead", "18 to go: about one every 2 weeks from now", "Goal reached on 14 Oct" (or "in October", "in 2026"). The info popover (glass) says how the goal counts, the pace of the last 90 days, the average length this year and last, and what is left out.
- **The rhythm** (`src/components/reading/rhythm.tsx`): seven 16px squares in the week's order, filled sage on a reading day, outlined otherwise, today with an outline 2px out; the day's initial under each; "4 of 5 days this week". Under it, 12 bars 8px wide, 4 to 32px tall by reading days, sage when the week reached the target, `bg-tertiary` otherwise, and "kept 9 of the last 12 weeks".
- Both are drawn on the server with its reading day and redrawn in the browser with the browser's, at the same height.

### Charts

The reading charts (SLN-456, `src/components/reading/charts/`) are hand-drawn SVG, no chart library: bars (`BarChart`), the calendar (`CalendarHeatmap`), and ranked lists in HTML (`RankList`, a thin sage bar under each row's text).

- **One tab stop.** Each chart sits in `ChartFrame`: an HTML wrapper with `tabIndex={0}`, `role="group"`, an `aria-label` naming the chart and `aria-describedby` pointing at its caption line. Its only other control is "Show as table".
- **Arrow keys** move a focus point: Left and Right by one bar or day, Up and Down by a week in the calendar (by one in a bar chart), Home and End to the first and last (`moveFocus`, `src/lib/reading/charts.ts`). The focused mark has a steel outline. Focus leaving the chart clears it.
- **Caption line and live region.** Under the chart, a 14px `fg-secondary` line says the focused value ("March 2025: 4 books"), or the whole chart in words before a point is chosen; a polite live region says the same as the focus moves.
- **The SVG** inside has `role="img"` with the summary as its `aria-label`, and nothing focusable in it. Hover shows a mark's exact value through `data-tooltip` on the mark; the keyboard value is the caption line, never a tooltip.
- **"Show as table"** (a button with `aria-expanded`) shows the same numbers as a table under the chart.
- **Never scaled.** No text is scaled through `viewBox`: the SVG's width is measured with a `ResizeObserver` and its height is fixed per chart, so nothing moves when it measures. Labels are 12px (`text-micro`) or 14px (`text-xs`) in `fg-secondary`.
- **Colors**: sage and blue fills, `bg-tertiary` tracks, `glass-border` grid lines; never color alone, since every value is also text. Calendar shades are sage at 30, 55, 80 and 100%, against the year's busiest day.
- **Narrow screens and many bars**: under 480px of width, or when its labels would not fit side by side (`barsFit`: about 7px a character, 8px apart), a bar chart turns into horizontal bars; the calendar (four blocks of week rows) scrolls inside its own box under 600px, never the page.
- Dates in labels use fixed English month and weekday names (no `Intl`), so the server and the browser write the same text.

### Suggestions

A suggestion (SLN-457, `src/components/reading/suggestions/`) is a row like Up Next's, never a card grid: a 64px cover, the title (the Anathema mark beside it in `CapAligned`), the author, one 14px line (length · where the copy is · time to read), up to three reasons in `fg-primary`, the predicted rating in `fg-secondary`, then its actions on one wrapping row (Start reading, Add to Up Next, Not now, Why this?, a menu). Reasons are plain sentences with their evidence: "Next in Les Rougon-Macquart after La Curée (you gave it 4.5)", "On your shelf in Amsterdam, Study"; never a score.

- **Why this?** is a glass popover (one material; it never scrolls, its list does): each feature's share of the score as a thin sage bar under its label and percentage, its reason, and its evidence links. A feature that lowers the score says "halves the score" and has no bar.
- **Pick one for me** is a dialog with one book: its cover, title, reasons, Another and Start reading.
- Not now, Never and Not for me take effect at once with a 10-second Undo toast; nothing asks for confirmation.

### Print

Every page prints light and without the app around it (SLN-456, `@media print` in `globals.css`): the colour tokens switch to dark text on white, the sidebar and the phone bar are `print:hidden`, the page takes the full width, and colours print as drawn. A page hides its own controls with `print:hidden` and keeps blocks whole with `break-inside-avoid` (the Year in review).

### Quotes and notes

A quote or note (`NoteItemView`, `src/components/reading/note-item.tsx`, SLN-453) looks the same on the book page, on `/reading/notes` and on the hub.

- The passage is long reading text: `Prose` (EB Garamond, the `type-prose` role, 4.5:1 or more), its line breaks kept (`whitespace-pre-line`). A quote has a 2px rule at its left (`border-accent-primary/40`) and 16px before the text; a note has none.
- His thought sits under it in 14px `fg-secondary` text, aligned with the passage's text (18px in for a quote).
- Then one 12px line: where it is ("p. 212 · ch. 7 · 2nd read"; on `/reading/notes` the book's title first, a link), with the star (`FavouriteToggle`) and the menu at its right in `CapAlignedControls height={32} coarseHeight={44}`: 32px targets, 44px on touch. On touch, "Show all" grows to a 48px target with negative margins, so the line keeps its height.
- Items are separated by a `glass-border` rule and 20px above and below; the first has no rule.
- **A long group** on the book page (12 or more) opens at its first 10, then a `glass-border` rule and "Show all 200" in 12px `fg-secondary`, 16px under the rule; on touch it grows to a 48px target with negative margins (SLN-510).
- **The passage of the day** on `/reading` is the same quote layout under a `SectionHeading` "Passage of the day" with "Another" at its right, then a caption: the book (a link), author and page. A passage over 600 characters opens at 8 lines with "Show all".
- **The note dialog** is a `max-w-lg` dialog: Quote / Note (`SegmentedControl`), the labelled text area, page and chapter side by side, the reading, "Your thought" (`TiptapEditor`) for a quote, and a Favourite switch. On touch the empty text area has a one-line hint, "To copy a printed page, tap and hold here, then Scan Text."

### The reading view

The e-book reader (`/reader/[ebookId]`, SLN-492; docs/04, Reader) is the book and two bars, nothing else.

- **Bars.** The top bar (Back, the serif title with the chapter beside it, Contents, Settings, Full screen) and the bottom bar (the chapter and the percent) are `glass-bar`. The bar's buttons sit on the title's cap-height center (`CapAligned`), are 32px (44px on a coarse pointer) and each has an `aria-label` and a tooltip with its key. Both bars show on open, hide together after 3 seconds of reading or on a turn, and come back together; hidden, they are `inert`.
- **Dialogs.** Contents and Settings are glass dialogs over `glass-veil`, with real labels and named controls; they take focus, keep Tab inside, close on Escape and give focus back to their button.
- **The page inside the book** uses the dark theme: the book's frames cannot see the app's CSS variables, so `src/lib/reader/presentation.ts` resolves `bg-primary`, `fg-primary`, `accent-blue-text` (links) and `accent-primary` (selection) to literal colours and writes them into each section's styles. Images stay as the publisher made them. The reading fonts are EB Garamond (Serif) and Inter (Sans), served from `public/fonts/reader/` under stable names the frames can load; "Original" keeps the book's own fonts.
- **Errors** are a plain panel in the page: the title, the reason in one sentence, Retry, "Open the PDF instead" for another readable file, and Back. A place that no longer resolves opens at the start with a toast, never a blank page.

### Tooltips

One tooltip for the whole app (`src/components/ui/tooltip.tsx`, mounted once in the root layout). Never use the native `title` attribute: it shows late, in the system's light style, and never on keyboard focus.

- Add `data-tooltip="Label"` to the control. It shows on hover after 300 ms and at once on keyboard focus; Escape, a click, scroll or leaving closes it.
- `data-tooltip-keys` shows the control's shortcut as key caps: `"b"`, `"alt f"`, `"g then b"` (a sequence).
- `data-tooltip-side`: `top` (default), `bottom`, `right`, `left`. It flips when it does not fit.
- Text cut by `truncate`, `lines-1` or `lines-2` shows its full text on hover, with no attribute.
- Style: glass (`glass`), 14px text, 6px from the control. It renders in the top layer, above dialogs.

---

## Iconography

**Lucide** icons exclusively.

| Property | Value |
|---|---|
| Stroke width | 1.5px (thinner than Lucide default) |
| Navigation size | 16px |
| Inline size | 14px |
| Maximum size | 16px for interface icons |

Rules:
- Icons **supplement** text. An icon-only control (a menu trigger, a copy button) has an `aria-label` and a tooltip (`data-tooltip`, see Tooltips)
- An image placeholder (an empty cover, an empty collection, a card with no photo) may use a larger, decorative icon at low contrast, 20-40px; it is not an interface icon
- No emoji anywhere in the interface
- Icons inherit text color. A mark or status icon takes its accent: rare in gold, poison in red
- An icon or drawing that repeats on every card of a grid stays light (page weight, SLN-481). The star draws the page's star symbol (`<svg><use href="#favourite-star"/></svg>`, `favourite-star.tsx`, in the root layout): the favourite toggle and the card rating (`CardRating`) both do. A drawing's colors go in a CSS utility, not inline on each shape: the stand-in flacon (`Flacon`) uses `flacon` in `globals.css`. A Lucide icon inline costs about 650 bytes a card, its symbol about 100

---

## Scrollbar

Minimal, dark scrollbar that blends with the interface:

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--color-bg-tertiary); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: var(--color-fg-muted); }
```

---

## Text Selection

Selection uses the ink selection token as background with primary foreground text:

```css
::selection {
  background-color: var(--color-selection-bg);
  color: var(--color-fg-primary);
}
```

---

## Responsive Behavior

- **Desktop** (over 800px): Full sidebar visible, multi-column grids, data tables
- **Tablet** (768–800px): The sidebar is the 56px icon rail; the saved width comes back above 800px
- **Phone** (under 768px, Tailwind `md`): No sidebar. A glass navigation bar (`mobile-nav-bar.tsx`, 48px) holds the menu button, the name and search; the menu opens the sidebar as a drawer over the page, with labels, and its section list scrolls. The page gutter is 16px (24px from `md`). Detail headers stack the poster above the title below `sm`; header actions wrap below a long title. Touch targets are at least 44px

The application is designed desktop-first but must be usable on all screen sizes. No separate mobile app — responsive web only. PWA if needed later.

A page must not scroll sideways at 375px. Check it with `node scripts/qa/phone-audit.mjs --base <app url>` (headless Chrome, `scripts/qa/overflow-audit.js` at 375 and 390px). A backdrop that bleeds to the edges of `main` (`-mx-4 md:-mx-6`) must match the page gutter.

### Progress bars and rich text

- `ProgressBar` (`src/components/shared/progress-bar.tsx`): 4px tall, 2px radius, `accent-blue` while reading and `accent-sage` when finished, on a `bg-tertiary` track. It is a `progressbar` whose `aria-valuetext` says the number in words ("44 percent, page 212 of 480"); the number is always shown as text nearby too.
- `TiptapEditor` (`src/components/shared/tiptap-editor.tsx`) is the rich text field for reviews and notes: bold, italic, link, bulleted and numbered lists and quote, each an icon button with `aria-label` and a tooltip (44px on touch). It saves HTML and Tiptap JSON and opens an imported review from its HTML. `CommentEditor` is built on it with its own extra tools. `rich-text-editor.tsx` stays for author bios. A dialog that uses it loads it on opening, so a page ships no editor until then.
- The book page's header row under the title holds the reading control first, then the Read button: both 32px tall (44px on touch) with an 8px gap.
- `ReadingTabs` (`src/components/reading/reading-tabs.tsx`) is the tab row of every reading page, under the page title: links with the collection switch's colors (the current one `selection-bg`, `aria-current="page"`), 32px tall, 44px on touch. The row is always one line: when the tabs do not fit (below `md` once later steps add theirs) it scrolls sideways inside itself, never the page, and the current tab is scrolled into view. Later reading pages add their tab to it in its fixed order; no page builds a second row.
- Lists that repeat a reading many times (the journal's rows, the dashboard's tiles, finished covers) are client components with small props (`src/components/reading/reading-tiles.tsx`), so a page sends each item's few fields once instead of its whole element tree.

### Keyboard, touch and motion

- Every control takes focus with Tab and shows it: the steel focus outline. Menus open with Enter, move with the arrow keys and close with Escape; a dialog keeps Tab inside it, and Escape closes it and returns focus to the control that opened it. A keyboard tooltip on the focused control takes the first Escape.
- Search: `S` opens the command palette from any page but the e-book reader (where `S` opens the reader's settings), as `⌘K` does; `/` goes to the page's own search field. Escape closes every search surface, one layer per press: the palette, a popover or menu, then the dialog around it. A list under a search field closes first (the field's text clears, as in the publisher and place pickers), and focus goes back to where it was. In a search field on a page, Escape leaves the field and keeps its text.
- On a touch screen (a coarse pointer), every control's press area is at least 44 × 44px (WCAG 2.5.5), and the desktop look does not change. A link inside running text, and a plain text link with no box of its own (a name in a detail list), are exempt. A control that shows on hover also shows on a touch screen. Three ways, in this order:
  - **The control grows** where its row has room: `pointer-coarse:min-h-11` (or `h-11`, `size-11`). Buttons (`Button`, `buttonClass`), menu items, fields and selects, the filter row (search, sorts, Filter, views, the size slider), pagination, the collection switch and the settings nav do this.
  - **Beside text**, the control sits in `CapAligned` or `CapAlignedControls` with `coarseHeight={44}` and grows with it: the favourite star (cards, rows, headers), the header action menus, the book's marks.
  - **A small mark that must keep its size** (a chip on a cover, a chip's ×, a back link, View all) gets an invisible press area: `touch-hit` (`globals.css`), a centred layer of at least 44 × 44px; it also positions the control (`relative`). It needs no clipping ancestor (a `CapAligned` box clips; use `CapAlignedControls`), and two such areas must not overlap: grouped artwork actions grow to separate 44px buttons on touch.
  - **A repeated icon button** keeps its classes short (page weight): `icon-hit` is its padding, 0.5rem and 0.875rem on touch (32px and 44px around a 16px icon at the default font size; in rem, so it grows with the reader's font size as the spacing scale does), and `icon-hit-end` pulls it past a column's end so the icon lines up (the favourite star in `CardHeading`). A title that cuts off (`lines-1`) clips its own overflow, so the cut goes on a span inside the link and `touch-hit` on the link.
- Check it with `scripts/qa/touch-audit.js` at 390px with a coarse pointer (Chromium and WebKit `isMobile` and `hasTouch`; Firefox with `ui.primaryPointerCapabilities` set to 1): it lists every control whose press area, cut by any clipping ancestor up to the first one that scrolls it, is under 44px, and the text links apart. A control in a scrolling box (a dialog's body, a rail) counts whole, up to what the box shows, since the reader scrolls it into view; a small one is listed wherever it is scrolled. The rating input has 44px whole-star targets on touch (see Ratings).
- A menu beside text goes in `CapAlignedControls`, never in `CapAligned`: `CapAligned`'s box clips, so a menu drawn inside it opens as a sliver whose items cannot be clicked. `CapAlignedControls` takes the same `height` and `coarseHeight` and clips nothing. `src/__tests__/cap-aligned-menus.test.ts` fails on a menu inside `CapAligned`.
- With the system's reduced-motion setting, nothing moves or loops: every animation and transition ends at once (`globals.css`), spinners and skeletons included. Their events still fire.
- Check it with `node scripts/qa/interaction-audit.mjs --disposable --base <app url> [route...]` on a disposable preview (`scripts/qa/preview-local.py`). It opens closed and nested details through their native summaries, audits newly revealed controls without reloading, and restores disclosure and unsaved dialog state even when a check fails. It opens menus and dialogs using Tab and arrow keys, pressing only controls that open something, never one that writes; it refuses to start without `--disposable`, on another host or on port 3100. A bounded reverse walk also checks controls before a dialog's initial field when forward Tab retains its last stop. The default Chrome CDP driver needs no package. For all three engines use `--browsers chromium,firefox,webkit` with the existing `PLAYWRIGHT_CORE` runtime and `PLAYWRIGHT_BROWSERS_PATH` browser cache (no dependency installation). On macOS WebKit, opt in with `WEBKIT_OPTION_TAB=1` for reported native Option-Tab and Option-Shift-Tab traversal that includes links without changing saved preferences. Plain-Tab link traversal depends on the browser preference; the default and other engines retain Tab and Shift-Tab, and the opt-in is rejected on other platforms.

- Run the serial native focus-probe regression with `PLAYWRIGHT_CORE=<installed runtime> node --test scripts/qa/interaction-animation.native.test.mjs`, using the audit driver's existing browser paths. It uses the real dialog entrance CSS in a local fixture, reproduces the old animation restart, checks focus and style restoration, and retains missing-ring failures. No application or database is needed.
