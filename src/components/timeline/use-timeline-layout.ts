"use client";

import { useMemo } from "react";
import type { TimelineTransform } from "./use-timeline-transform";

export interface TimelineLayoutItem {
  year: number;
}

export interface PositionedItem<T extends TimelineLayoutItem> {
  item: T;
  screenX: number;
}

/**
 * Computes screen-space X positions for timeline items and culls items that
 * are outside the current viewport.
 *
 * @param items           Source items that each carry a `year` field.
 * @param transform       Current pan/zoom transform.
 * @param containerWidth  Width of the visible viewport in pixels.
 * @param pixelsPerYear   Base pixels per year at scale === 1.
 * @param minYear         The year that maps to world-X = 0.
 */
export function useTimelineLayout<T extends TimelineLayoutItem>(
  items: T[],
  transform: TimelineTransform,
  containerWidth: number,
  pixelsPerYear: number,
  minYear: number,
): { visibleItems: (T & { screenX: number })[] } {
  const visibleItems = useMemo(() => {
    const { offsetX, scale } = transform;
    const result: (T & { screenX: number })[] = [];

    for (const item of items) {
      // world-space X for this year
      const worldX = (item.year - minYear) * pixelsPerYear;
      // screen-space X
      const screenX = worldX * scale + offsetX;

      // Cull: only include items whose position falls within the viewport
      // (with a 60px margin so partially-visible items at edges are included)
      if (screenX < -60 || screenX > containerWidth + 60) continue;

      result.push({ ...item, screenX });
    }

    return result;
  }, [items, transform, containerWidth, pixelsPerYear, minYear]);

  return { visibleItems };
}
