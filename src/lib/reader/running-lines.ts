import type { DurtalLocator, Marginalia, Presentation } from "./engine";
import type { PositionIndex } from "./position-index";
export const RUNNING_ITEMS = [
  "chapter",
  "page",
  "location",
  "percent",
  "timeLeftChapter",
  "timeLeftBook",
  "clock",
] as const;
export type RunningItem = (typeof RUNNING_ITEMS)[number];
export const RUNNING_POSITIONS = [
  "off",
  "headerLeft",
  "headerRight",
  "footerLeft",
  "footerRight",
] as const;
export type RunningPosition = (typeof RUNNING_POSITIONS)[number];
export type RunningPositions = Record<RunningItem, RunningPosition>;
export const DEFAULT_RUNNING_POSITIONS: RunningPositions = {
  chapter: "headerLeft",
  page: "footerRight",
  location: "off",
  percent: "footerRight",
  timeLeftChapter: "footerLeft",
  timeLeftBook: "off",
  clock: "off",
};
export function runningPositions(
  storage: Pick<Storage, "getItem"> | null,
): RunningPositions {
  const positions = { ...DEFAULT_RUNNING_POSITIONS };
  try {
    const raw = JSON.parse(
      storage?.getItem("durtal-reader-running-lines") ?? "null",
    );
    if (raw?.v === 1)
      for (const item of RUNNING_ITEMS)
        if (RUNNING_POSITIONS.includes(raw.positions?.[item]))
          positions[item] = raw.positions[item];
  } catch {
    /* Defaults. */
  }
  return positions;
}
export function saveRunningPositions(
  storage: Pick<Storage, "setItem"> | null,
  positions: RunningPositions,
) {
  try {
    storage?.setItem(
      "durtal-reader-running-lines",
      JSON.stringify({ v: 1, positions }),
    );
  } catch {
    /* This open still works. */
  }
}
export function pageText(locator: DurtalLocator, index: PositionIndex) {
  const label = locator.pageLabel;
  if (!label)
    return (
      "Location " +
      index.locationFor(locator).toLocaleString() +
      " of " +
      index.info.locationCount.toLocaleString()
    );
  const last = index.info.pageList.at(-1)?.label;
  return (
    "p. " +
    label +
    (last && /^\d+$/.test(last) && /^\d+$/.test(label) ? " of " + last : "")
  );
}
const rgb = (hex: string) =>
  [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const luminance = (color: number[]) =>
  color
    .map((n) => n / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
    .reduce((sum, n, at) => sum + n * [0.2126, 0.7152, 0.0722][at], 0);
export function contrast(a: string, b: string) {
  const x = luminance(rgb(a)),
    y = luminance(rgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function mutedInk(
  theme: Pick<Presentation["colors"], "background" | "text">,
) {
  const background = rgb(theme.background),
    text = rgb(theme.text);
  for (let percent = 60; percent <= 100; percent += 5) {
    const color =
      "#" +
      text
        .map((n, at) =>
          Math.round((n * percent) / 100 + background[at] * (1 - percent / 100))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    if (contrast(color, theme.background) >= 4.5) return color;
  }
  return theme.text;
}
export function renderRunningLines(input: {
  positions: RunningPositions;
  locator: DurtalLocator;
  index: PositionIndex;
  chapter: string | null;
  timeLeftChapter: string;
  timeLeftBook: string;
  clock: string;
  linear: boolean;
  statusFilled: boolean;
  color: string;
}): Marginalia {
  const { locator, index } = input;
  const values: Record<RunningItem, string> = {
    chapter: input.chapter ?? "",
    page: pageText(locator, index),
    location: "Location " + index.locationFor(locator).toLocaleString(),
    percent: Math.round(locator.totalProgression * 100) + "%",
    timeLeftChapter: input.timeLeftChapter,
    timeLeftBook: input.statusFilled ? "" : input.timeLeftBook,
    clock: input.clock,
  };
  if (!input.linear) {
    values.page = "Outside the reading order";
    values.location = "";
    values.timeLeftChapter = "";
    values.timeLeftBook = "";
  }
  const at = (position: RunningPosition) =>
    RUNNING_ITEMS.filter((item) => input.positions[item] === position)
      .map((item) => values[item])
      .filter(Boolean)
      .join(" · ");
  return {
    head: [at("headerLeft"), at("headerRight")],
    foot: [at("footerLeft"), at("footerRight")],
    color: input.color,
  };
}
