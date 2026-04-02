/**
 * Crystal pipeline: transforms raw Vibrant swatches into a ready-to-render
 * CrystalColor[] palette that conforms to Durtal's design language.
 *
 * Steps:
 *  1. Collect non-null swatches, score by composite metric
 *  2. Diversity filter via delta-E (reject if too close to an already-selected color)
 *  3. Clamp saturation/lightness to design-language bounds
 *  4. Assign roles (primary, secondary, accent, halo) with recommended opacities
 */

import type { ColorSwatch, CrystalColor } from "@/lib/types";
import {
  rgbToHsl,
  deltaE,
  clampColor,
  rgbToHex,
  DURTAL_CLAMP,
} from "./color-math";

// ── Configuration ───────────────────────────────────────────────────────────

const MIN_DELTA_E = 25;

const ROLE_ORDER: CrystalColor["role"][] = ["primary", "secondary", "accent", "halo"];

// Per-role opacity multiplier: primary is strongest, halo is subtlest
const ROLE_OPACITY_SCALE: Record<CrystalColor["role"], number> = {
  primary: 1.0,
  secondary: 0.80,
  accent: 0.65,
  halo: 0.50,
};

// Gothic fallback palette (from design tokens) used when extraction yields nothing
const GOTHIC_FALLBACK_RGB: [number, number, number][] = [
  [142, 64, 87],   // --color-gothic-crimson #8e4057
  [70, 41, 65],    // --color-gothic-mulberry #462941
  [88, 110, 117],  // --color-accent-slate #586e75
];

// ── Scoring ─────────────────────────────────────────────────────────────────

interface ScoredSwatch {
  rgb: [number, number, number];
  hsl: [number, number, number];
  population: number;
  score: number;
}

/**
 * Score a swatch by how useful it is as an ambient crystal color.
 * Higher score = more interesting color for atmospheric use.
 *
 * Weights:
 *  - saturation (40%): we want colorful, not grey
 *  - population ratio (30%): respect the cover's actual color distribution
 *  - lightness distance from extremes (30%): avoid pure black/white
 */
function scoreSwatch(
  swatch: ColorSwatch,
  totalPopulation: number,
): ScoredSwatch {
  const hsl = rgbToHsl(...swatch.rgb);
  const [, s, l] = hsl;

  const saturationScore = s / 100;
  const populationScore = totalPopulation > 0 ? swatch.population / totalPopulation : 0;
  // Distance from extremes: 0 at L=0 or L=100, peaks at L=50
  const lightnessScore = 1 - Math.abs(l - 50) / 50;

  const score =
    saturationScore * 0.4 +
    populationScore * 0.3 +
    lightnessScore * 0.3;

  return { rgb: swatch.rgb, hsl, population: swatch.population, score };
}

// ── Opacity assignment ──────────────────────────────────────────────────────

/**
 * Lighter colors are more visually prominent on dark backgrounds,
 * so they get lower opacity. Range: 0.20 (lightest) to 0.40 (darkest).
 *
 * On the near-black page background (#030507), opacity below ~0.15 is
 * effectively invisible after blur. These values are calibrated to produce
 * a visible-but-subtle ambient glow.
 */
function computeOpacity(lightness: number): number {
  const { minLightness, maxLightness } = DURTAL_CLAMP;
  const t = Math.max(0, Math.min(1, (lightness - minLightness) / (maxLightness - minLightness)));
  // Interpolate: dark → higher opacity, light → lower opacity
  return 0.40 - t * 0.20;
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Build the crystal palette from raw Vibrant swatches.
 * Returns 0-4 CrystalColor entries, each with a role and recommended opacity.
 */
export function buildCrystalPalette(
  swatches: Record<string, ColorSwatch | null>,
): CrystalColor[] {
  // 1. Collect non-null swatches
  const candidates: ColorSwatch[] = [];
  for (const key of Object.keys(swatches)) {
    const sw = swatches[key];
    if (sw && sw.population > 0) candidates.push(sw);
  }

  if (candidates.length === 0) {
    return buildFallbackPalette();
  }

  // Total population for normalizing scores
  const totalPop = candidates.reduce((sum, c) => sum + c.population, 0);

  // 2. Score and sort descending
  const scored = candidates
    .map((c) => scoreSwatch(c, totalPop))
    .sort((a, b) => b.score - a.score);

  // 3. Diversity filter: select up to 4 colors with sufficient delta-E distance
  const selected: ScoredSwatch[] = [];

  for (const candidate of scored) {
    if (selected.length >= 4) break;

    const tooClose = selected.some(
      (s) => deltaE(candidate.rgb, s.rgb) < MIN_DELTA_E,
    );
    if (tooClose) continue;

    selected.push(candidate);
  }

  // If we got fewer than 2 diverse colors, relax the threshold and try again
  if (selected.length < 2) {
    const relaxed: ScoredSwatch[] = [];
    for (const candidate of scored) {
      if (relaxed.length >= 3) break;
      const tooClose = relaxed.some(
        (s) => deltaE(candidate.rgb, s.rgb) < MIN_DELTA_E * 0.5,
      );
      if (tooClose) continue;
      relaxed.push(candidate);
    }
    if (relaxed.length > selected.length) {
      selected.length = 0;
      selected.push(...relaxed);
    }
  }

  // If still nothing usable, return gothic fallback
  if (selected.length === 0) {
    return buildFallbackPalette();
  }

  // 4. Clamp to design-language bounds and assign roles
  const crystal: CrystalColor[] = selected.map((s, i) => {
    const clamped = clampColor(s.rgb);
    const [, , cl] = rgbToHsl(...clamped);
    const role = ROLE_ORDER[i];
    return {
      hex: rgbToHex(...clamped),
      rgb: clamped,
      opacity: computeOpacity(cl) * ROLE_OPACITY_SCALE[role],
      role,
    };
  });

  return crystal;
}

// ── Fallback ────────────────────────────────────────────────────────────────

function buildFallbackPalette(): CrystalColor[] {
  return GOTHIC_FALLBACK_RGB.slice(0, 3).map((rgb, i) => {
    const clamped = clampColor(rgb);
    const [, , cl] = rgbToHsl(...clamped);
    return {
      hex: rgbToHex(...clamped),
      rgb: clamped,
      opacity: computeOpacity(cl) * 0.7, // subtler for fallback
      role: ROLE_ORDER[i],
    };
  });
}
