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
| `--color-fg-secondary` | `#7d8380` | Secondary text, descriptions, metadata |
| `--color-fg-muted` | `#4a4f4d` | Disabled text, placeholders, tertiary info |

### Accents

| Token | Hex | Usage |
|---|---|---|
| `--color-accent-rose` | `#7d3d52` | Primary interactive (buttons, focus rings, active states) |
| `--color-accent-plum` | `#20131e` | Selection highlight, active nav item background |
| `--color-accent-slate` | `#586e75` | Secondary accent, info badges |
| `--color-accent-gold` | `#c0a36e` | Metadata highlights, ratings, special indicators |
| `--color-accent-sage` | `#76946a` | Success states, positive indicators |
| `--color-accent-red` | `#bb3e41` | Destructive actions, error states |
| `--color-accent-blue` | `#648493` | Links, informational badges |

### Gothic Underlay

| Token | Hex | Usage |
|---|---|---|
| `--color-gothic-crimson` | `#8e4057` | Hover glows, decorative border accents |
| `--color-gothic-mulberry` | `#462941` | Deep underlay for focus states |

All colors are desaturated and muted. No bright neons. Accents should feel like they are emerging from darkness, not projected onto it.

---

## Typography

Three font families serve distinct roles:

| Role | Family | Weight | Fallbacks | Character |
|---|---|---|---|---|
| **Serif** | EB Garamond | 400 (normal) | Georgia, serif | Literary, elegant, never bold |
| **Sans** | Inter | 400 | Work Sans, system-ui, sans-serif | Clean, readable, modern |
| **Mono** | JetBrains Mono | 400 | IBM Plex Mono, SF Mono, monospace | Technical, ISBNs, codes |
| **UI Chrome** | Inter | 500 | system-ui, sans-serif | Buttons, navigation |

Headings are deliberately normal weight — understated. Boldness is used sparingly for emphasis, never as default.

### Font Loading

Fonts are loaded via `next/font/google` in the root layout with the following configuration:

```typescript
const garamond = EB_Garamond({ subsets: ["latin"], variable: "--font-serif" });
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```

CSS custom properties (`--font-serif`, `--font-sans`, `--font-mono`) are set via Tailwind's `@theme` block, allowing usage throughout as `font-serif`, `font-sans`, `font-mono` utility classes.

### Hierarchy

- **Page titles**: Serif, large
- **Section headings**: Serif
- **Card titles**: Serif
- **Body text**: Sans
- **Metadata labels**: Sans, secondary color
- **Data values**: Sans or mono depending on content
- **ISBNs, IDs**: Mono

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

### Glassmorphism

Used **exclusively** on two elements:
1. **Navigation bar** — Subtle backdrop blur
2. **Command palette** — Backdrop blur overlay

Nowhere else. No frosted glass cards, no blurred panels.

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
| **Danger** | transparent | 1px `accent-red` | `accent-red` | Destructive actions |

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
- Dark overlay with slight blur
- Squared corners (4px max)
- No drop shadow — use border instead
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
- Icon-only buttons require a tooltip or `aria-label`

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
