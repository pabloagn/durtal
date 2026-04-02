"use client";

import type { CrystalColor } from "@/lib/types";

interface AmbientCrystalsProps {
  palette: CrystalColor[];
}

/**
 * Deterministic pseudo-random number from a string seed.
 */
function seededRandom(seed: string, index: number): number {
  let hash = 0;
  const str = seed + index;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return ((hash & 0x7fffffff) % 1000) / 1000;
}

/**
 * Each palette color spawns multiple blobs at different sizes and positions
 * so the result looks like an organic nebula rather than one uniform smear.
 */
function generateBlobParams(palette: CrystalColor[]) {
  const seed = palette.map((c) => c.hex).join("");

  // Define layout archetypes — the seed picks one so different palettes
  // get structurally different compositions, not just color swaps.
  const archetypeIndex = Math.floor(seededRandom(seed, 999) * 5);

  // Anchor zones per archetype: [xMin, xMax, yMin, yMax] for each slot
  const archetypes: [number, number, number, number][][] = [
    // 0 — top-left cluster + bottom-right wisp
    [[5, 35, 5, 35], [55, 90, 45, 75], [10, 50, 30, 60], [60, 85, 10, 30]],
    // 1 — center-left pillar + top-right accent
    [[8, 40, 10, 70], [50, 85, 5, 30], [25, 60, 40, 70], [65, 95, 50, 80]],
    // 2 — diagonal slash (top-left → bottom-right)
    [[5, 30, 5, 25], [25, 50, 25, 45], [45, 70, 40, 60], [65, 95, 55, 80]],
    // 3 — flanking (left + right edges, top gap)
    [[2, 25, 15, 55], [75, 98, 20, 60], [30, 60, 5, 30], [35, 65, 50, 75]],
    // 4 — scattered asymmetric
    [[10, 35, 5, 25], [60, 90, 10, 40], [5, 30, 50, 75], [50, 80, 55, 80]],
  ];

  const zones = archetypes[archetypeIndex];

  const roleBaseOpacity: Record<string, number> = {
    primary: 0.70,
    secondary: 0.50,
    accent: 0.40,
    halo: 0.25,
  };

  interface BlobDef {
    color: CrystalColor;
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    rotation: number;
    opacity: number;
    blur: number;
  }

  const blobs: BlobDef[] = [];
  let blobIndex = 0;

  palette.forEach((color, i) => {
    const r = (offset: number) => seededRandom(seed, blobIndex * 17 + offset);
    const zone = zones[i % zones.length];

    // --- Main blob: large, anchored in its zone ---
    const mainCx = zone[0] + r(0) * (zone[1] - zone[0]);
    const mainCy = zone[2] + r(1) * (zone[3] - zone[2]);
    const mainRx = 60 + r(2) * 60; // 60%–120%
    const mainRy = 50 + r(3) * 50; // 50%–100%
    const mainRot = r(4) * 360;
    const baseOp = (roleBaseOpacity[color.role] ?? 0.35) * Math.min(color.opacity / 0.25, 1.2);

    blobs.push({
      color,
      cx: mainCx, cy: mainCy,
      rx: mainRx, ry: mainRy,
      rotation: mainRot,
      opacity: baseOp,
      blur: 100 + r(5) * 40, // 100–140px
    });
    blobIndex++;

    // --- Secondary blob: medium, offset from main ---
    const offAngle = r(6) * Math.PI * 2;
    const offDist = 12 + r(7) * 25;
    const secCx = mainCx + Math.cos(offAngle) * offDist;
    const secCy = mainCy + Math.sin(offAngle) * offDist * 0.6;

    blobs.push({
      color,
      cx: secCx, cy: secCy,
      rx: 35 + r(8) * 40, // 35%–75%
      ry: 30 + r(9) * 35, // 30%–65%
      rotation: r(10) * 360,
      opacity: baseOp * (0.5 + r(11) * 0.3),
      blur: 80 + r(12) * 40, // 80–120px
    });
    blobIndex++;

    // --- Tertiary wisp: smaller accent (not every color) ---
    if (r(13) > 0.35) {
      const wispCx = mainCx + (r(14) - 0.5) * 35;
      const wispCy = mainCy + (r(15) - 0.5) * 30;

      blobs.push({
        color,
        cx: wispCx, cy: wispCy,
        rx: 20 + r(16) * 30, // 20%–50%
        ry: 18 + r(17) * 25, // 18%–43%
        rotation: r(18) * 360,
        opacity: baseOp * (0.3 + r(19) * 0.3),
        blur: 50 + r(20) * 40, // 50–90px
      });
      blobIndex++;
    }
  });

  return blobs;
}

/**
 * Ambient color gradients sampled from the book's poster.
 *
 * Renders as its own absolutely-positioned layer at the page root.
 * Uses a CSS mask-image to feather ALL edges (top, bottom, left, right)
 * into transparency — no overflow-hidden, no hard cutoffs anywhere.
 */
export function AmbientCrystals({ palette }: AmbientCrystalsProps) {
  if (!palette || palette.length === 0) return null;

  const blobs = generateBlobParams(palette);

  return (
    <div
      className="pointer-events-none absolute -left-6 -top-6 -right-6 z-0 h-[650px]"
      aria-hidden="true"
    >
      {/* Blobs — individually blurred at different radii for depth */}
      <div
        className="absolute inset-0"
        style={{
          transform: "scale(1.3)",
          transformOrigin: "center 35%",
        }}
      >
        {blobs.map((blob, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${blob.cx}%`,
              top: `${blob.cy}%`,
              width: `${blob.rx}%`,
              height: `${blob.ry}%`,
              transform: `translate(-50%, -50%) rotate(${blob.rotation}deg)`,
              background: `radial-gradient(ellipse at center, ${blob.color.hex} 0%, transparent 55%)`,
              opacity: blob.opacity,
              filter: `blur(${blob.blur}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Poster glow ──────────────────────────────────────────────────────────────

interface PosterGlowProps {
  palette: CrystalColor[];
}

export function PosterGlow({ palette }: PosterGlowProps) {
  if (!palette || palette.length === 0) return null;

  const primary = palette.find((c) => c.role === "primary");
  const secondary = palette.find((c) => c.role === "secondary") ?? palette[1];

  if (!primary) return null;

  const glowColor = primary.hex;
  const secondaryColor = secondary?.hex ?? primary.hex;

  return (
    <div
      className="pointer-events-none absolute -inset-6 -z-10"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 50%, ${glowColor}40 0%, transparent 70%)`,
          filter: "blur(30px)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 60% 80% at 40% 60%, ${secondaryColor}30 0%, transparent 65%)`,
          filter: "blur(25px)",
        }}
      />
    </div>
  );
}
