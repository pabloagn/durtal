import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import { filterColour, fitBackgroundContrast, fitContrast } from "./contrast";

export interface ReaderTheme {
  background: string;
  text: string;
  selection: string;
  link: string;
  colorScheme: "dark" | "light";
}

/** Quiet Glass dark values supersede the ticket's pre-SLN-556 palette. */
export const READER_THEMES = {
  "durtal-dark": {
    background: "#07090d",
    text: "#c5cacb",
    selection: "#17232d",
    link: "#8c9fae",
    colorScheme: "dark",
  },
  sepia: {
    background: "#e8dcc4",
    text: "#3a3026",
    selection: "#d3bf98",
    link: "#7a6a52",
    colorScheme: "light",
  },
  paper: {
    background: "#ecebe6",
    text: "#1e2120",
    selection: "#c9d2d5",
    link: "#5d6f78",
    colorScheme: "light",
  },
} as const satisfies Record<ReaderPresentation["theme"], ReaderTheme>;

/** Dark/quote/search fills are supplied by SLN-500's approved decoration contract. */
export const LIGHT_THEME_HIGHLIGHTS = {
  sepia: {
    ochre: "#dcb783",
    sage: "#9ccca0",
    slate: "#80cae1",
    rose: "#eaa9b9",
    violet: "#bdb5ee",
  },
  paper: {
    ochre: "#dcb783",
    sage: "#9ccca0",
    slate: "#80cae1",
    rose: "#eaa9b9",
    violet: "#bdb5ee",
  },
} as const;

/** Only page colours change; the host's tokens and chrome are never mutated. */
export function themeColours(p: ReaderPresentation): ReaderTheme {
  const theme = READER_THEMES[p.theme];
  const filter = (hex: string) => filterColour(hex, p.brightness, p.warmth);
  return {
    background: filter(theme.background),
    text: filter(theme.text),
    selection: filter(
      fitBackgroundContrast(theme.selection, theme.background, theme.text, p),
    ),
    link: filter(theme.link),
    colorScheme: theme.colorScheme,
  };
}

/** Used by the eventual section pass against original publisher declarations. */
export function adaptTextColour(
  original: string,
  p: ReaderPresentation,
): string {
  const theme = READER_THEMES[p.theme];
  return filterColour(
    fitContrast(original, theme.background, theme.text, p),
    p.brightness,
    p.warmth,
  );
}

/** The final decoration layer supplies its source fills and actual blend opacity. */
export function highlightColours<T extends Record<string, string>>(
  p: ReaderPresentation,
  source: T,
  opacity = 1,
): Record<keyof T, string> {
  const theme = READER_THEMES[p.theme];
  return Object.fromEntries(
    Object.entries(source).map(([name, fill]) => [
      name,
      filterColour(
        fitBackgroundContrast(fill, theme.background, theme.text, p, opacity),
        p.brightness,
        p.warmth,
      ),
    ]),
  ) as Record<keyof T, string>;
}
