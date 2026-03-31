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
      style={{
        position: "fixed",
        left: adjusted.x,
        top: adjusted.y,
        zIndex: 50,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 150ms ease",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--color-glass-border)",
        backgroundColor: "rgba(10, 13, 16, 0.95)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "6px 10px",
        maxWidth: 280,
        fontSize: "var(--text-xs)",
        color: "var(--color-fg-primary)",
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
}
