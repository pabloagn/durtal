"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import type { CrystalColor } from "@/lib/types";

interface AmbientCrystalsProps {
  palette: CrystalColor[];
  /** Optional className override for the outer container */
  className?: string;
}

/**
 * Per-role gradient layout. Each role maps to an ellipse position, size,
 * and rendering opacity. Oversized so that blur + scale push all edges
 * well outside the container — no hard rectangle boundaries.
 */
const ROLE_LAYOUT: Record<
  CrystalColor["role"],
  { cx: string; cy: string; rx: string; ry: string; opacity: number }
> = {
  primary:   { cx: "50%", cy: "30%", rx: "140%", ry: "120%", opacity: 0.85 },
  secondary: { cx: "80%", cy: "70%", rx: "120%", ry: "110%", opacity: 0.55 },
  accent:    { cx: "15%", cy: "60%", rx: "100%", ry: "100%", opacity: 0.45 },
  halo:      { cx: "50%", cy: "50%", rx: "150%", ry: "140%", opacity: 0.25 },
};

/**
 * Renders an ambient color field from extracted crystal palette colors.
 *
 * Each color becomes a large radial gradient ellipse. Separate divs are
 * used (not stacked CSS backgrounds) so overlapping areas alpha-composite
 * naturally. The container applies heavy blur + upscale so edges dissolve
 * far outside the visible area — no hard rectangle artifacts.
 */
export function AmbientCrystals({ palette, className }: AmbientCrystalsProps) {
  if (!palette || palette.length === 0) return null;

  return (
    <div
      className={className ?? "pointer-events-none absolute inset-0"}
      aria-hidden="true"
      style={{
        filter: "blur(80px)",
        transform: "scale(1.4)",
        transformOrigin: "center center",
      }}
    >
      {palette.map((color, i) => {
        const layout = ROLE_LAYOUT[color.role];
        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse ${layout.rx} ${layout.ry} at ${layout.cx} ${layout.cy}, ${color.hex}, transparent 70%)`,
              opacity: layout.opacity,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Portals the ambient color field directly onto document.body so it
 * truly covers the entire viewport — behind sidebar, behind everything.
 * No parent containing block can trap it.
 */
export function AmbientPortal({ palette }: { palette: CrystalColor[] }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !palette || palette.length === 0) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ zIndex: 0 }}
    >
      <AmbientCrystals palette={palette} />
    </div>,
    document.body,
  );
}
