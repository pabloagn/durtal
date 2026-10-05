# Design Language

Dark-mode only. Gothic-minimal aesthetic. The interface should feel like it belongs alongside Linear and a personal website built with obsessive typographic care — dark, precise, quietly unsettling.

No light mode. No theme toggle.

---

## Philosophy

The interface should feel like browsing a private library in a dimly lit study — sophisticated, quiet, precise. The aesthetic draws from Linear (information density, keyboard-first), Sacred Computer (dark minimalism, typographic hierarchy), and Serge Lutens (underlying strangeness beneath extreme polish). Not a replica of any. A synthesis.

Information density is high, ornamentation is absent, and every pixel earns its place. The palette is desaturated and muted — no bright neons, no saturated primaries. Color appears sparingly as accent, never as decoration.

---

## Color Palette

### Backgrounds

| Token | Hex | Usage |
|---|---|---|
| `--color-bg-primary` | `#030507` | Page background, root |
| `--color-bg-secondary` | `#0a0d10` | Cards, panels, sidebar |
| `--color-bg-tertiary` | `#14171c` | Hover states, alternating rows, subtle borders |

### Foregrounds

| Token | Hex | Usage |
|---|---|---|
| `--color-fg-primary` | `#c1c6c4` | Body text, titles, primary content |
| `--color-fg-secondary` | `#7d8380` | Secondary text, descriptions, metadata, labels, counts, dates |
| `--color-fg-muted` | `#4a4f4d` | Disabled text, placeholders, separators, decorative icons. Never text a reader needs |

**Contrast.** Text that a reader needs is at least 4.5:1 against its background (3:1 at 24px and larger). `fg-secondary` is 4.6–5.3:1 on the three backgrounds; `fg-muted` is 2.2–2.5:1, so it is for decoration only. `scripts/qa/design-audit.js` lists every text under the limit.

### Accents

| Token | Hex | Usage |
|---|---|---|
| `--color-accent-rose` | `#7d3d52` | Primary interactive (buttons, focus rings, active states). Fills, borders and rings only |
| `--color-accent-rose-text` | `#b96b83` | Rose text: links, active labels, rose badges (4.7–5.3:1) |
| `--color-accent-plum` | `#20131e` | Selection highlight, active nav item background |
| `--color-accent-slate` | `#586e75` | Secondary accent, info badges |
| `--color-accent-gold` | `#c0a36e` | Metadata highlights, ratings, special indicators |
| `--color-accent-sage` | `#76946a` | Success states, positive indicators |
| `--color-accent-red` | `#bb3e41` | Destructive actions, error states. Fills, borders and icons only |
| `--color-accent-red-text` | `#cf5f5e` | Red text: destructive actions, errors (4.7–5.3:1) |
| `--color-accent-blue` | `#648493` | Links, informational badges |

### Over images

Small controls and marks that sit on a cover, poster or portrait are glass on the image (`glass-chip`, see Glass): the selection box, the copy button, the card actions menu, the image adjustment button and the cover chips (`cover-chip.ts`, on book, film, perfume, painting and reader cards). Larger layers over an image use the page's near-black, never pure black or white:

| Token | Value | Usage |
|---|---|---|
| `--color-overlay` | `bg-primary` at 85% | The media manager's hover actions over a whole thumbnail (`bg-overlay`) |
| `--color-scrim` | `bg-primary` at 70% | A banner dimmed behind a page header (book, author, collection, publisher and film pages) |
| `--color-scrim-deep` | `bg-primary` at 90% | The lightbox around an open image; its buttons keep 16px icons in `fg-secondary` |

Text and icons on them are `fg-primary`; text on an `accent-rose` fill is `fg-primary` too (5.0:1). No `bg-black` or `text-white`, and no blur of their own: blur belongs to the glass.

### Gothic Underlay

| Token | Hex | Usage |
|---|---|---|
| `--color-gothic-crimson` | `#8e4057` | Hover glows, decorative border accents |
| `--color-gothic-mulberry` | `#462941` | Deep underlay for focus states |

All colors are desaturated and muted. No bright neons. Accents should feel like they are emerging from darkness, not projected onto it.

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
| `text-2xl` | 30px | Section titles, dialog titles |
| `text-3xl` | 38px | Stat numbers |
| `text-4xl` | 46px | Page titles |

### Roles

A heading never picks its own size and color: it uses its role. Each role sets family, size, line height, tracking and color.

| Role | Look | Use |
|---|---|---|
| `type-page-title` | Serif 46px, tight tracking, primary | The h1 of every page (`PageHeader`) |
| `type-section-title` | Serif 30px, primary | Every titled block on a page, through `SectionHeading`; dialog titles |
| `type-item-title` | Serif 21px, line height 1.375, primary | Card titles, the title of a block inside a section, empty and error states |
| `type-group-title` | Serif 21px, secondary | A group of fields in a form or dialog |
| `type-stat` | Serif 38px, tight tracking | The number in a stat tile |
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
| `--radius-sm` | `2px` | Default for buttons, inputs, cards |
| `--radius-md` | `4px` | Modals, larger containers |
| `--radius-lg` | `8px` | Reserved (rarely used) |
| `--radius-full` | `9999px` | Pills, avatars |

The default is squared, not rounded. Everything feels precise and angular. No `rounded-full` or pill shapes.

### Glass

One glass material, for surfaces that float above the page. Subtle and controlled, in the spirit of Linear: it reads first as a dark panel. The view behind it only tints it, and its edge catches a faint light from above. It is never a frosted card on the page itself.

**The material** (`glass` in `src/styles/globals.css`):

| Layer | Value |
|---|---|
| Tint | `--color-glass-tint`: `bg-secondary` at 88% |
| What lies behind | blurred 24px, saturation 150%, brightness 30% |
| Light from above | `--color-glass-sheen`: a 2% white wash over the top 56px |
| Edge | a 1px hairline (`--color-glass-edge`, 10%), its top line lit (`--color-glass-edge-lit`) |
| Corners | 4px (`--radius-md`) |
| Depth | three soft shadows: 1px contact, 32px float, 64px ambient |

The tint and the dimmed backdrop keep `fg-secondary` text at 4.5:1 or more over any image: 4.64:1 at the lit top edge over pure white, measured on the screen. `design-audit.js` cannot see through glass, so check text on a glass surface by its pixels.

**Where it goes:**

| Surface | Utility |
|---|---|
| Command palette, leader menus (A, G, Y, E, R), dialogs | `glass`, with `glass-veil` behind (`backdrop:glass-veil` on a `<dialog>`) |
| Menus, select lists, date picker, filter panels, pickers (also films' search picker), hover cards | `glass` |
| Tooltips | `glass` |
| Selection toolbars | `glass` |
| A bar fixed to a screen edge: the navigation bar on a phone, the sidebar (a drawer over the page on a phone), the reader's toolbar and progress bar | `glass-bar`: the same material, square corners, no shadow, a border only on the side facing the page |
| A small control or mark on an image: cover chips, a card's copy, actions and selection controls, the image adjustment button | `glass-chip`: a 72% tint over the image blurred 10px (3px on a 16px cover mark, where a wide radius keeps the image's edges), saturated 180% and dimmed to 60%, a hairline edge lit from above (`border` on the element). The dimming is in the tint, so Chrome, Safari and Firefox draw it alike. The image shows through as smoked glass; an icon keeps 3:1 and a label 4.5:1 even over a white cover. Labels are `fg-primary`, a tone colors only the icon. `glass-chip-lift` brightens it on hover; controls that show on hover fade their glass (`hover-reveal-glass`), not a wrapper, so the blur is there all through the fade |
| What lies behind the phone drawer | `glass-veil` |

`glass-veil` is the layer behind a modal surface: the page at 62% black, blurred 6px, so it stays in view but steps back.

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
- Hover: lifts with `accent-rose` border glow
- The cover shows its art. Only the marks that make a copy special sit on it: rare, poison and digital edition, as one cluster in the bottom-left corner. Their chips (`src/components/books/cover-chip.ts`) share one size and inset and an opaque backdrop (`bg-primary` at 85%, no blur), so they read on white and on black covers alike. Controls on a cover (the actions menu, copy, image adjustment) show on hover and keyboard focus, and always on a touch screen, which has no hover (`hover-reveal` in `globals.css`).
- Text, through `CardHeading` (`src/components/shared/card-heading.tsx`): the title in the serif (`type-item-title`), then the author 4px under the title's last line. The block always takes two title lines and one author line, so every card has the same height; a one-line title leaves its free line above the info row, not between the title and the author. A title cut by its `line-clamp-2` shows in full on hover, like text cut by `lines-*`.
- Info row, in secondary text: the status as a colored dot and its label (`CardStatus`; the tooltip adds the priority and the number of copies), the language from 200px card width, then on the right the rating (a gold star and the number, `CardRating`, from 160px) and the year (from 160px; 220px beside a rating). The status always fits whole.

Author, series, collection and dashboard cards follow the same layout. Author cards: name, nationality, then the years and the number of books. Series cards: title, original title, then the counts and "Complete" in gold. Collection cards: name with its icon, two lines of description, then the edition count. No count or status sits on a portrait or a cover.

### Buttons

Four variants:

| Variant | Background | Border | Text | Usage |
|---|---|---|---|---|
| **Primary** | `accent-rose` | none | `fg-primary` | Primary actions |
| **Secondary** | transparent | 1px `bg-tertiary` | `fg-secondary` | Secondary actions |
| **Ghost** | transparent | none | `fg-secondary` | Tertiary actions |
| **Danger** | transparent | 1px `accent-red` | `accent-red-text` | Destructive actions |

Three sizes: `sm`, `md` (default), `lg`. All squared (2px radius). Focus ring uses `accent-rose`.

### Inputs

- Minimal border (`bg-tertiary`)
- Transparent background
- `accent-rose` focus ring
- No rounded corners (2px radius)
- Optional label displayed above

### Ratings

A work's rating is 0.5 to 5 in half steps, the same for books, films, perfumes and paintings (venue ratings are another scale). One component shows and edits it (`src/components/shared/rating.tsx`); the number is written by `formatRating` (`src/lib/utils/rating.ts`): "4" or "4.5", never "4.0".

- `RatingStars`: five Lucide stars at 1.5 stroke, 12px in rows, 14px in a header, 16px at most. Filled parts are `accent-gold`; a half star fills its left half (a clipped second icon). Empty stars and halves are outlined in `fg-secondary`, never `fg-muted`. Read as "Rated 4.5 out of 5" or "Not rated".
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

Sonner toast notifications. Appear at bottom-right. Dark theme matching the application palette.

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

Selection uses the plum accent as background with primary foreground text:

```css
::selection {
  background-color: var(--color-accent-plum);
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

### Keyboard, touch and motion

- Every control takes focus with Tab and shows it: the rose focus ring, or a text field's rose border. Menus open with Enter, move with the arrow keys and close with Escape; a dialog keeps Tab inside it, and Escape closes it and returns focus to the control that opened it. A keyboard tooltip on the focused control takes the first Escape.
- On a touch screen, a control is at least 24px, or spaced so that a 24px circle on its center touches no other control (WCAG 2.5.8). A link inside running text is exempt. A control that shows on hover also shows on a touch screen. The rating input has 44px whole-star targets there (see Ratings).
- With the system's reduced-motion setting, nothing moves or loops: every animation and transition ends at once (`globals.css`), spinners and skeletons included. Their events still fire.
- Check it with `node scripts/qa/interaction-audit.mjs --disposable --base <app url> [route...]` on a disposable preview (`scripts/qa/preview-local.py`). It opens menus and dialogs, pressing only controls that open something, never one that writes; it refuses to start without `--disposable`, on another host or on port 3100.
