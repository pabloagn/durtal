"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface TimelineTooltipProps {
  x: number;
  y: number;
  children: ReactNode;
  visible: boolean;
}

const OFFSET_X = 12;
const OFFSET_Y = -8;

export function TimelineTooltip({ x, y, children, visible }: TimelineTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [adjusted, setAdjusted] = useState({ x, y });

  // Auto-reposition to stay within viewport after render
  useEffect(() => {
    if (!visible || !ref.current) return;

    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nx = x + OFFSET_X;
    let ny = y + OFFSET_Y;

    if (nx + rect.width > vw - 8) {
      nx = x - rect.width - OFFSET_X;
    }
    // On a narrow screen neither side may have room: keep it inside
    nx = Math.max(8, Math.min(nx, vw - rect.width - 8));
    if (ny + rect.height > vh - 8) {
      ny = y - rect.height - Math.abs(OFFSET_Y);
    }
    if (ny < 8) {
      ny = 8;
    }

    setAdjusted({ x: nx, y: ny });
  }, [x, y, visible]);

  return (
    <div
      ref={ref}
      role="tooltip"
      // The glass material, like every tooltip and menu
      className="glass max-w-[280px] px-2.5 py-1.5 text-xs leading-[1.4] text-fg-primary"
      style={{
        position: "fixed",
        left: adjusted.x,
        top: adjusted.y,
        zIndex: 50,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 150ms ease",
      }}
    >
      {children}
    </div>
  );
}
