"use client";

import { useSyncExternalStore } from "react";
import { usePreference } from "./use-preference";
import { SIDEBAR, sidebarExpandedWidth, sidebarWidth } from "@/lib/preferences";

const COMPACT_QUERY = "(min-width: 768px) and (max-width: 800px)";
function subscribe(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const compactSnapshot = () => window.matchMedia(COMPACT_QUERY).matches;
const serverSnapshot = () => false;

/** The rail on tablets defaults closed; an explicit choice overrides it on this browser. */
export function useSidebarPreference() {
  const compact = useSyncExternalStore(subscribe, compactSnapshot, serverSnapshot);
  const [stored, setStored] = usePreference<number>(SIDEBAR.key, SIDEBAR.expanded);
  const [last, setLast] = usePreference<number>(SIDEBAR.expandedKey, sidebarExpandedWidth(stored));
  const [compactExpanded, setCompactExpanded] = usePreference<boolean>(SIDEBAR.compactKey, false);
  const expandedWidth = sidebarExpandedWidth(last);
  const compactWidth = compactExpanded === true ? expandedWidth : SIDEBAR.collapsed;
  const width = compact ? compactWidth : sidebarWidth(stored);

  function setWidth(next: number) {
    const normalized = sidebarWidth(next);
    if (normalized !== SIDEBAR.collapsed) setLast(normalized);
    // A legacy custom width may not yet have an expanded-width cookie.
    else if (width !== SIDEBAR.collapsed) setLast(width);
    if (compact) setCompactExpanded(normalized !== SIDEBAR.collapsed);
    else setStored(normalized);
  }

  return {
    width,
    setWidth,
    toggle: () => setWidth(width === SIDEBAR.collapsed ? expandedWidth : SIDEBAR.collapsed),
  };
}
