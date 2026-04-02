# Task 0064: Ambient Color Crystallization

**Status**: Completed
**Created**: 2026-03-31
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

Add crystallized, blurred ambient color effects to the book detail page, derived from each book's poster image. The effect produces soft, organic color blobs that sit behind the content and above the background, creating a living, bespoke atmosphere for each book. Inspired by Plex Amp's album-art ambient glow and Apple's liquid crystal aesthetic, but filtered through Durtal's gothic-minimal design language: desaturated, muted, emerging from darkness.

The system has two halves: a **server-side color extraction pipeline** that intelligently builds a palette from each poster, and a **client-side rendering layer** that paints the crystallized blobs using pure CSS with dynamic custom properties.

---

## Part 1: Color Extraction Pipeline

### 1.1 Install `node-vibrant`

```bash
pnpm add node-vibrant
```

`node-vibrant` v4 uses Modified Median Cut Quantization (MMCQ) and extracts six semantic swatches (Vibrant, Muted, DarkVibrant, DarkMuted, LightVibrant, LightMuted), each with hex, RGB, population count, and pre-computed accessible text colors. It accepts `Buffer` directly via the `node-vibrant/node` import — no additional image library needed. `sharp` is already installed.

### 1.2 Schema: Add `colorPalette` JSONB Column to `media` Table

Add a `colorPalette` JSONB column to the `media` table. This is the right place because the palette is a property of a specific image (a poster), not the abstract work. Different posters for the same work can produce different palettes.

**Migration**: Add to `src/lib/db/schema/media.ts`:

```typescript
colorPalette: jsonb("color_palette"),
```

**Stored JSON shape** (typed as `ColorPalette` in `src/lib/types/index.ts`):

```typescript
export interface ColorSwatch {
  hex: string;        // e.g. "#7d3d52"
  rgb: [number, number, number];
  hsl: [number, number, number];
  population: number; // pixel count — useful for weighting
}

export interface ColorPalette {
  vibrant: ColorSwatch | null;
  muted: ColorSwatch | null;
  darkVibrant: ColorSwatch | null;
  darkMuted: ColorSwatch | null;
  lightVibrant: ColorSwatch | null;
  lightMuted: ColorSwatch | null;
  dominant: { hex: string; rgb: [number, number, number] }; // from sharp stats()
  // Post-processed colors ready for direct CSS use — the "crystal" palette
  crystal: CrystalColor[];
  extractedAt: string; // ISO timestamp
}

export interface CrystalColor {
  hex: string;
  rgb: [number, number, number];
  opacity: number;    // recommended opacity for this blob (0.08–0.18)
  role: "primary" | "secondary" | "accent" | "halo";
}
```

The `crystal` array is the post-processed, ready-to-use palette. It contains 3-4 colors that have been diversity-checked, desaturated to match the design language, and assigned roles with recommended opacities.

Generate and run the migration with:
```bash
pnpm db:generate
pnpm db:migrate
```

Update `docs/02_DATA_MODEL.md` to document the new column.

### 1.3 Color Extraction Utility

Create `src/lib/color/extract-palette.ts`:

**Core extraction function:**

```typescript
import { Vibrant } from "node-vibrant/node";

export async function extractColorPalette(buffer: Buffer): Promise<ColorPalette>
```

**Algorithm — multi-pass with diversity enforcement:**

1. **First pass**: `Vibrant.from(buffer).quality(3).maxColorCount(128).getPalette()`
2. **Completeness check**: Count non-null swatches. If fewer than 4, re-run with `quality(1).maxColorCount(256).clearFilters()` (removes the default filter that discards near-white/near-black, allowing better extraction from predominantly dark covers like *House of Leaves*).
3. **Dominant color supplement**: Run `sharp(buffer).stats()` to get the single dominant color. Store it separately — it's useful context even if it's black.
4. **Post-processing** (see 1.4 below): Build the `crystal[]` array from the raw swatches.

**Edge case handling:**

- **Mostly black/dark covers** (e.g., *House of Leaves*): The `clearFilters()` retry allows extraction of accent colors that would otherwise be filtered out. If after two passes all swatches are still null or within delta-E < 10 of each other, fall back to the gothic underlay palette (`#8e4057`, `#462941`) as crystal colors. This ensures every book gets *something*.
- **Mostly white/light covers**: Unlikely in this collection, but if lightness > 85% on all swatches, darken and desaturate before storing.
- **Monochromatic covers**: If all non-null swatches share the same hue (within 15 degrees), generate complementary/split-complementary variants by rotating hue by 150 and 210 degrees. Reduce their saturation heavily so they remain subtle.

### 1.4 Post-Processing: The Crystal Pipeline

Create `src/lib/color/crystal-pipeline.ts`:

This transforms raw Vibrant swatches into the final `CrystalColor[]` array — the colors that will actually be rendered as ambient blobs.

**Steps:**

1. **Collect candidates**: Gather all non-null swatches. Rank by a composite score:
   ```
   score = (saturation * 0.4) + (population_ratio * 0.3) + (lightness_distance_from_extremes * 0.3)
   ```
   This biases toward colorful, well-represented, mid-range colors — not the darkest dominant mass, not the brightest outlier.

2. **Diversity filter**: Process candidates top-down. For each candidate, compute CIE76 delta-E (Euclidean distance in Lab space) against all already-selected colors. Reject if delta-E < 25 against any selected color. This prevents two variations of the same purple from both making the cut.

   The delta-E computation is straightforward:
   ```
   deltaE = sqrt((L1-L2)^2 + (a1-a2)^2 + (b1-b2)^2)
   ```
   Convert from RGB to Lab using the standard RGB -> XYZ -> Lab pipeline. No external library needed — it's ~30 lines of math.

3. **Design language normalization** (all adjustments in HSL):
   - **Saturation cap**: Clamp S to max 65%. The design language says "desaturated and muted" — no vivid neons.
   - **Lightness floor**: Clamp L to min 18%. Below this, colors are invisible on `#030507`.
   - **Lightness ceiling**: Clamp L to max 45%. Above this, blobs become too prominent and compete with content.
   - **Saturation floor**: Clamp S to min 12%. Below this, the color reads as grey and adds no atmosphere.

4. **Role assignment**: Select 3-4 colors from the filtered candidates:
   - **Primary** (blob 1): Highest composite score. Opacity 0.14-0.18.
   - **Secondary** (blob 2): Second highest, must be delta-E > 25 from primary. Opacity 0.10-0.14.
   - **Accent** (blob 3): Third highest, must be delta-E > 25 from both. Opacity 0.08-0.12.
   - **Halo** (blob 4, optional): If a fourth color passes the filter, include it at very low opacity (0.06-0.10) as a subtle halo near the poster. Skip if fewer than 4 diverse colors are available.

5. **Opacity assignment**: Based on lightness. Lighter colors get lower opacity (they're more visually prominent), darker colors get slightly higher opacity.
   ```
   opacity = lerp(0.18, 0.08, (lightness - 18) / (45 - 18))
   ```

### 1.5 Integration Point: Media Upload Pipeline

Hook color extraction into the existing media processing pipeline. There are two entry points:

**A. `processAndUploadMedia()` in `src/lib/s3/media.ts`** — called when a poster is uploaded via the media manager. After the image is processed and before the function returns, run:

```typescript
if (mediaType === "poster") {
  const palette = await extractColorPalette(buffer);
  // Store palette on the media record (see 1.6)
}
```

The buffer is already in memory. Extraction adds ~100-200ms — negligible compared to S3 upload latency.

**B. `processAndUploadCover()` in `src/lib/s3/covers.ts`** — called during ingestion when a cover is fetched from an external URL. Same integration: extract palette from the buffer before uploading.

### 1.6 Storing the Palette

After extraction, update the media record:

```typescript
await db.update(media)
  .set({ colorPalette: palette })
  .where(eq(media.id, mediaId));
```

This happens in the server action that handles media upload (likely `src/lib/actions/media.ts` or wherever the media upload action lives). The palette is stored as JSONB and retrieved alongside the media record when loading the book detail page.

### 1.7 Backfill Script

Create a server action or standalone script that backfills palettes for all existing poster media records that have `colorPalette IS NULL`:

1. Query all media records where `type = 'poster'` and `colorPalette IS NULL`
2. For each, download the image from S3 using the existing `s3Key`
3. Run `extractColorPalette(buffer)`
4. Update the record

This can be a server action triggered from an admin button, or a script run via `pnpm tsx scripts/backfill-palettes.ts`. Process sequentially with a small concurrency limit (3-5) to avoid overwhelming S3.

---

## Part 2: Ambient Crystallization Rendering

### 2.1 Component: `AmbientCrystals`

Create `src/app/library/[slug]/ambient-crystals.tsx` — a client component that renders the crystallized color blobs.

**Props:**

```typescript
interface AmbientCrystalsProps {
  palette: CrystalColor[];  // 3-4 colors from the crystal pipeline
}
```

**Rendering strategy — pure CSS with dynamic custom properties:**

The component renders a container div with 3-4 child divs (the blobs). Each blob is absolutely positioned, has a solid background color, organic border-radius, and a large blur filter. The container has `mix-blend-mode: screen` to create additive light blending on the dark background.

```tsx
"use client";

export function AmbientCrystals({ palette }: AmbientCrystalsProps) {
  if (!palette || palette.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ mixBlendMode: "screen" }}
      aria-hidden="true"
    >
      {palette.map((color, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            backgroundColor: color.hex,
            opacity: color.opacity,
            ...BLOB_CONFIGS[color.role],
          }}
        />
      ))}
    </div>
  );
}
```

### 2.2 Blob Configuration

Each blob role has a fixed spatial configuration. These are carefully chosen to create visual interest without competing with the poster or background.

```typescript
const BLOB_CONFIGS: Record<CrystalColor["role"], React.CSSProperties> = {
  primary: {
    width: "380px",
    height: "340px",
    top: "5%",
    right: "15%",
    borderRadius: "40% 60% 70% 30% / 60% 30% 70% 40%",
    filter: "blur(100px)",
    animation: "crystal-drift-1 80s ease-in-out infinite",
  },
  secondary: {
    width: "320px",
    height: "280px",
    bottom: "10%",
    left: "20%",
    borderRadius: "60% 40% 30% 70% / 40% 70% 30% 60%",
    filter: "blur(120px)",
    animation: "crystal-drift-2 90s ease-in-out infinite",
  },
  accent: {
    width: "260px",
    height: "240px",
    top: "40%",
    right: "5%",
    borderRadius: "50% 50% 40% 60% / 60% 40% 50% 50%",
    filter: "blur(110px)",
    animation: "crystal-drift-3 70s ease-in-out infinite",
  },
  halo: {
    width: "200px",
    height: "180px",
    top: "10%",
    left: "5%",
    borderRadius: "45% 55% 65% 35% / 55% 35% 65% 45%",
    filter: "blur(80px)",
    animation: "crystal-drift-4 100s ease-in-out infinite",
  },
};
```

**Key sizing notes:**
- Blobs are sized in `px` not `%` because the blur radius is absolute. Percentage sizing would cause inconsistent blur-to-size ratios at different viewport widths.
- On mobile (< 768px), scale blobs down by ~40% and reduce blur radius by ~30% via a media query or responsive style.
- The `borderRadius` values use the 8-value shorthand to create asymmetric, organic shapes. After the blur is applied, these look like soft, amoeba-like forms — not circles, not squares.

### 2.3 CSS Keyframes: Subtle Drift Animation

Add to `src/styles/globals.css`:

```css
/* ── Ambient crystal drift ─────────────────────────────────────────────── */
@keyframes crystal-drift-1 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  25%      { transform: translate(15px, -20px) scale(1.03); }
  50%      { transform: translate(-10px, 10px) scale(0.97); }
  75%      { transform: translate(20px, 5px) scale(1.02); }
}

@keyframes crystal-drift-2 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33%      { transform: translate(-20px, 15px) scale(1.04); }
  66%      { transform: translate(15px, -10px) scale(0.96); }
}

@keyframes crystal-drift-3 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  20%      { transform: translate(10px, 15px) scale(0.98); }
  50%      { transform: translate(-15px, -10px) scale(1.03); }
  80%      { transform: translate(5px, -20px) scale(1.01); }
}

@keyframes crystal-drift-4 {
  0%, 100% { transform: translate(0, 0) scale(1); }
  40%      { transform: translate(-10px, 10px) scale(1.02); }
  70%      { transform: translate(12px, -8px) scale(0.98); }
}
```

**Animation characteristics:**
- **Duration**: 70-100 seconds per cycle. Subliminal — the user should never consciously notice movement, only feel that the page is "alive".
- **Offset keyframe stops**: Each animation has different percentages (25/50/75 vs 33/66 vs 20/50/80) so the blobs never synchronize. This avoids a pulsing rhythm.
- **Translation**: 10-20px movement only. Imperceptible at any given moment.
- **Scale**: 0.96-1.04 range. A 4% size change is invisible after blur.
- **Timing function**: `ease-in-out` for smooth, organic deceleration at direction changes.
- **`will-change: transform`**: Add to each blob for GPU compositing. `transform` animations run on the compositor thread — zero main-thread cost.

**Accessibility**: Respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  [data-crystal-blob] {
    animation: none !important;
  }
}
```

### 2.4 Layer Integration on Book Detail Page

Modify `src/app/library/[slug]/page.tsx` to insert the ambient layer.

**Current z-index stack:**
```
z-0 (negative)  Background image + dark overlay + gradient
z-10             Content (header, poster, metadata, etc.)
```

**New z-index stack:**
```
z-0 (negative)  Background image + dark overlay + gradient
z-[1]            Ambient crystals layer (NEW)
z-[2]            Readability veil — very subtle dark scrim (NEW, conditional)
z-10             Content (header, poster, metadata, etc.)
```

Insert the `AmbientCrystals` component inside the cinematic backdrop container, between the background image layer and the content:

```tsx
{/* Background image layer */}
{background && (
  <div className="absolute inset-0 -z-0 overflow-hidden">
    {/* ... existing background image, dark overlay, gradient ... */}
  </div>
)}

{/* Ambient crystallization layer */}
{poster && posterPalette && (
  <div className="absolute inset-0 z-[1] overflow-hidden">
    <AmbientCrystals palette={posterPalette} />
  </div>
)}

{/* Content on top of the backdrop */}
<div className={background ? "relative z-10 px-6 pt-6 pb-2" : ""}>
```

**Important**: The crystals render whether or not there's a background image. If there's no background:
- With background: Blobs blend over the dark overlay (`bg-black/70`) — they glow softly through the darkened cover image.
- Without background: Blobs blend directly over `#030507` page background — they create ambient atmosphere even for books with only a poster and no background.

When there's no background image, the crystals container should be positioned absolutely relative to the header area, not the full page. Adjust the wrapper accordingly.

### 2.5 Readability Safeguard

**The cardinal rule: text readability must never be compromised.**

The existing `bg-black/70` overlay on the background image already provides strong contrast. The crystal blobs sit *above* this overlay but at very low opacity (0.08-0.18) with screen blend mode, so they add color without reducing contrast significantly.

However, as an extra safeguard, test the following:

1. Render text over the crystals and verify contrast ratios remain above WCAG AA (4.5:1 for body text, 3:1 for large text).
2. If any palette produces blobs that are too bright (this would require a failure in the lightness ceiling clamping), add a subtle dark veil between the crystals and the content:
   ```tsx
   <div className="absolute inset-0 z-[2] bg-bg-primary/20 pointer-events-none" />
   ```
   This should be conditional — only added if the palette contains colors with lightness > 40%.

### 2.6 Poster Non-Interference

The poster image sits in the content layer (`z-10`), well above the crystal blobs (`z-[1]`). No special handling is needed — the crystals are physically behind the poster in the z-stack.

The optional **halo** blob (blob 4) is positioned near the poster area and creates a subtle glow around the cover — as if light is spilling from the book itself. This is intentional and enhances the poster rather than competing with it.

### 2.7 No Background Image Variant

When a work has no background image but does have a poster with an extracted palette, the crystals should still render. In this case:

- Remove the negative z-index constraint (no background layer to sit behind)
- Position the crystal container as `absolute` within the header section
- Constrain height to the header area (~300px) so the effect doesn't bleed into the metadata sections below
- Add a bottom gradient dissolve so the crystals fade out gracefully

```tsx
{!background && poster && posterPalette && (
  <div className="absolute inset-x-0 top-0 h-80 overflow-hidden">
    <AmbientCrystals palette={posterPalette} />
    <div
      className="absolute inset-x-0 bottom-0 h-24"
      style={{
        background: "linear-gradient(to top, var(--color-bg-primary), transparent)",
      }}
    />
  </div>
)}
```

---

## Part 3: Data Flow

### 3.1 Server-Side: Fetching the Palette

The book detail page (`page.tsx`) is a server component. It already fetches the active poster media record. Extend this query to include `colorPalette`:

In the data-fetching function (likely `getWorkBySlug` in `src/lib/actions/works.ts`), ensure the poster media record includes the `colorPalette` field. Then in `page.tsx`:

```typescript
const posterPalette: CrystalColor[] | null = poster?.colorPalette?.crystal ?? null;
```

Pass `posterPalette` to the `AmbientCrystals` client component.

### 3.2 Fallback: No Palette Available

If a poster exists but has no extracted palette (legacy data, extraction failure), render no ambient effect. Do not use fallback colors by default — the page should look identical to its current state.

If a poster has a palette but all crystal colors were filtered out (extremely rare), same — no effect.

### 3.3 Re-extraction

When the user changes the active poster (via the media manager), the new poster's palette should be used. If the new poster has no palette, trigger extraction on the fly:

1. After setting a new poster as active, check if it has a `colorPalette`
2. If not, download the image from S3, extract, and store
3. The page will show the new palette on next load

---

## Part 4: Performance

### 4.1 Rendering Cost

- **3-4 blurred divs with transform animations**: Negligible GPU cost. Each blob is a single composited layer. `filter: blur()` is computed once and cached as a GPU texture; only `transform` changes per frame.
- **`mix-blend-mode: screen`**: Composited on the GPU. No main-thread cost.
- **`will-change: transform`**: Promotes each blob to its own compositing layer, ensuring smooth animation.

### 4.2 Extraction Cost

- **node-vibrant extraction**: ~100-200ms per image at `quality(3)`. Runs once at upload time, never at page load.
- **sharp stats()**: ~20-50ms. Already in the processing pipeline.
- **Total added latency to upload**: ~150-250ms. Imperceptible to the user during an upload operation that already takes 1-3 seconds.

### 4.3 Mobile Considerations

- Reduce blob count to 2-3 on viewports < 768px
- Reduce blur radius by 30% (e.g., `blur(70px)` instead of `blur(100px)`)
- Disable animation on `prefers-reduced-motion: reduce`
- Consider disabling the effect entirely on very low-end devices via a `@media (hover: none)` heuristic (crude but catches most low-end mobile)

---

## Part 5: File Manifest

### New Files

| File | Purpose |
|------|---------|
| `src/lib/color/extract-palette.ts` | Core extraction: node-vibrant + sharp stats() + multi-pass retry |
| `src/lib/color/crystal-pipeline.ts` | Post-processing: diversity filter, desaturation, role assignment |
| `src/lib/color/color-math.ts` | Pure math utilities: RGB-to-Lab, delta-E, HSL clamping |
| `src/app/library/[slug]/ambient-crystals.tsx` | Client component: renders the crystallized blob layer |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/db/schema/media.ts` | Add `colorPalette` JSONB column |
| `src/lib/types/index.ts` | Add `ColorPalette`, `ColorSwatch`, `CrystalColor` interfaces |
| `src/lib/s3/media.ts` | Call `extractColorPalette()` after processing poster images |
| `src/lib/s3/covers.ts` | Call `extractColorPalette()` after processing cover images |
| `src/app/library/[slug]/page.tsx` | Insert `AmbientCrystals` in the backdrop layer stack |
| `src/styles/globals.css` | Add `crystal-drift-*` keyframes and `prefers-reduced-motion` rule |
| `docs/02_DATA_MODEL.md` | Document `color_palette` column on `media` table |
| Server action for media upload | Store extracted palette after upload |

### New Dependency

| Package | Version | Purpose |
|---------|---------|---------|
| `node-vibrant` | ^4.0 | Semantic color extraction via MMCQ |

---

## Part 6: Acceptance Criteria

1. Every book with a poster displays ambient color crystals on its detail page
2. The crystals are derived from the poster's actual colors, not hardcoded
3. Dark/monochromatic covers (e.g., *House of Leaves*) produce visible, meaningful palettes — not just black blobs
4. Extracted palettes are desaturated and muted per the design language — no vivid neons or garish colors
5. Crystal diversity: at least 2 visually distinct hues in the palette (delta-E > 25)
6. Text readability is unaffected — all body text maintains WCAG AA contrast ratio (4.5:1) over the crystals
7. The poster image is not visually obscured or competed with
8. The background cover image (if present) remains visible through the dark overlay
9. Animation is subliminal (60-100s cycles, 10-20px translation) and respects `prefers-reduced-motion`
10. Palette extraction runs at upload time, not at page load — zero runtime extraction cost
11. Existing books are backfilled via a one-time migration script
12. `pnpm typecheck` passes
13. `pnpm build` succeeds

---

## Part 7: Visual Reference

**What it should feel like:**
- A book with a warm-toned cover (reds, golds) should have a subtle warm glow pervading the header area
- A book with a cool-toned cover (blues, silvers) should have a cold, ethereal atmosphere
- A book with a black cover and small red accent (e.g., *House of Leaves*) should show a dim red glow — not nothing, not overpowering
- The effect should be noticed on a subconscious level — the user should feel that each book page has its own personality without being able to immediately identify why
- If the user squints or looks at the page peripherally, they should see soft color. If they look directly at the content, they should see only text

**What it must NOT feel like:**
- A rave / neon party
- A washed-out mess that makes text hard to read
- A static colored rectangle behind the content
- Identical across all books (the whole point is per-book personality)
- Distracting — the crystals are background atmosphere, never foreground attention

## Completion Notes

Implemented 2026-03-31.

**New dependency**: `node-vibrant` v4.0.4 (MMCQ-based semantic color extraction).

**Schema change**: Added `color_palette` JSONB column to `media` table (migration `0015_bouncy_mole_man.sql`).

**New files created**:
- `src/lib/color/color-math.ts` — RGB/HSL/Lab conversion, delta-E distance, HSL clamping
- `src/lib/color/crystal-pipeline.ts` — Composite scoring, diversity filter (delta-E > 25), design-language normalization (S: 12-65%, L: 18-45%), role assignment with opacity
- `src/lib/color/extract-palette.ts` — Multi-pass node-vibrant extraction with WebP-to-PNG conversion, sharp stats dominant color
- `src/app/library/[slug]/ambient-crystals.tsx` — Client component rendering 3-4 blurred organic blobs with mix-blend-mode: screen
- `src/app/api/media/backfill-palettes/route.ts` — One-time backfill route for existing posters

**Modified files**:
- `src/lib/db/schema/media.ts` — Added `colorPalette` JSONB column
- `src/lib/types/index.ts` — Added `ColorSwatch`, `CrystalColor`, `ColorPalette` interfaces
- `src/lib/validations/media.ts` — Added `colorPalette` to create schema
- `src/app/api/media/upload/route.ts` — Extracts palette on poster upload (non-blocking)
- `src/app/library/[slug]/page.tsx` — Renders AmbientCrystals at z-[1] between background and content
- `src/styles/globals.css` — Crystal drift keyframes (70-100s cycles) with prefers-reduced-motion support
- `docs/02_DATA_MODEL.md` — Documented `color_palette` column and extraction pipeline

**Backfill**: 385 existing posters processed successfully (0 failures). WebP images are converted to PNG in-memory before extraction since node-vibrant doesn't support WebP natively.

**Key design decisions**:
- Extraction runs at upload time, not page load — zero runtime cost
- WebP → PNG conversion adds ~50ms but is necessary for node-vibrant compatibility
- Crystal colors are clamped to Durtal's design language bounds (no vivid neons)
- Blobs use `mix-blend-mode: screen` for additive light on the near-black background
- 70-100 second drift animations are subliminal and GPU-composited (transform only)
- Fallback to gothic underlay colors when extraction yields insufficient diversity
