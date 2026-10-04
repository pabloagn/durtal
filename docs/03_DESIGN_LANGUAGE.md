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
| **Mono** | JetBrains Mono | 400 | IBM Plex Mono, SF Mono, monospace | Technical, ISBNs, codes |
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

`SectionHeading` (`src/components/shared/section-heading.tsx`) is the only way to title a block on a page: title, optional count, icon, description and action, with 16px below. Sections are 32px apart (`mb-8`). Body and metadata text use the scale directly (`text-sm`, `text-xs`). Long reading text never uses the body size: it uses `<Prose>`.

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
| Command palette, leader menu, dialogs | `glass`, with `glass-veil` behind (`backdrop:glass-veil` on a `<dialog>`) |
| Menus, select lists, date picker, filter panels, pickers, hover cards | `glass` |
| Tooltips | `glass` |
| Selection toolbars | `glass` |
| A bar fixed to a screen edge (navigation on a phone) | `glass-bar`: the same material, square corners, no shadow, a border only on the side facing the page |

`glass-veil` is the layer behind a modal surface: the page at 62% black, blurred 6px, so it stays in view but steps back.

**How to use it.** Add the `glass` class to the floating element itself (`glass-bar` for a bar fixed to a screen edge), also on a native `<dialog>` or a cmdk list. The element needs a position and no background or border of its own; a `<dialog>` also takes `border-0 bg-transparent` against the browser's defaults. The material sits on a `::before` layer: a backdrop filter on the element itself would trap its `position: fixed` children, such as a picker inside a dialog.

**A glass surface never scrolls.** The `::before` layer would scroll away with the first screenful and leave the rest of a long list on the bare page. The glass element takes `overflow-hidden`; an element inside it scrolls (`max-h-56 overflow-y-auto` on a select's list). A dialog's body scrolls, not the dialog, so its header stays in view. `src/__tests__/glass-surfaces.test.ts` checks it.

**Never** on page content: cards, panels, sections, tables and the record column stay opaque (`bg-secondary`). Controls on top of an image use an opaque backdrop instead (cover chips, `src/components/books/cover-chip.ts`).

---

## Component Patterns

### Book Cards

- Dark background (`bg-secondary`)
- Cover image with no border radius
- Subtle 1px border in `bg-tertiary`
- Hover: lifts with `accent-rose` border glow
- Title in serif, author in muted sans
- Metadata (year, language, copy count) in secondary text

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

A section or group with nothing to show is left out; its "Add" action lives in the page's actions menu.

### Cards without a photo

A card never shows an empty box. `src/components/shared/no-photo.tsx` holds one family of placeholders, on the dark frame with a faint tint:

- Author with books: up to three of their covers, fanned (`CoverFan`). Author with no books: initials in the serif (`Monogram`).
- Place: a label with its kind and city in small capitals, a rule, and its street in the serif (`PlacePlate`).
- Series with no book yet: a shelf of spines, one per known volume (`ShelfSpines`).
- While an image loads, its frame shows the poster's main color, dimmed, and the image fades in (`FadeImage`, `coverToneStyle`).

### Tooltips

One tooltip for the whole app (`src/components/ui/tooltip.tsx`, mounted once in the root layout). Never use the native `title` attribute: it shows late, in the system's light style, and never on keyboard focus.

- Add `data-tooltip="Label"` to the control. It shows on hover after 300 ms and at once on keyboard focus; Escape, a click, scroll or leaving closes it.
- `data-tooltip-keys` shows the control's shortcut as key caps: `"b"`, `"alt f"`, `"g then l"` (a sequence).
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
| Maximum size | 16px |

Rules:
- Icons **supplement** text; they never replace it
- No emoji anywhere in the interface
- No colored icons — all icons inherit text color
- Icon-only controls have an `aria-label` and a tooltip (`data-tooltip`, see Tooltips)

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

- **Desktop**: Full sidebar visible, multi-column grids, data tables
- **Tablet**: Sidebar collapses or overlays, reduced grid columns
- **Mobile**: Single column, stacked layouts, touch-friendly targets

The application is designed desktop-first but must be usable on all screen sizes. No separate mobile app — responsive web only. PWA if needed later.
