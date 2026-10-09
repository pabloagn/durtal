export interface ReaderShortcut {
  key: string;
  label: string;
  group: string;
  issue: number;
  context: "always" | "selection" | "widget";
  plugin?: boolean;
}
const group = (
  name: string,
  issue: number,
  context: ReaderShortcut["context"],
  keys: Record<string, string>,
): ReaderShortcut[] =>
  Object.entries(keys).map(([key, label]) => ({
    key,
    label,
    group: name,
    issue,
    context,
  }));
export const READER_KEYMAP: readonly ReaderShortcut[] = [
  ...group("Turning pages", 3, "always", {
    arrowright: "Turn right",
    arrowleft: "Turn left",
    space: "Next page",
    "shift space": "Previous page",
    pagedown: "Next page",
    pageup: "Previous page",
    home: "First page",
    end: "Last page",
  }),
  ...group("Panels", 3, "always", {
    t: "Contents",
    s: "Settings",
    f: "Full screen",
    escape: "Close the active surface",
  }),
  ...group("Finding your way", 10, "always", {
    g: "Go to",
    "[": "Previous chapter",
    "]": "Next chapter",
    "alt arrowleft": "Back",
    "alt arrowright": "Forward",
    "?": "Reader shortcuts",
  }),
  ...group("Marking", 11, "always", { b: "Bookmark", h: "Highlights" }),
  ...group("Marking", 11, "selection", {
    "1": "Highlight colour 1",
    "2": "Highlight colour 2",
    "3": "Highlight colour 3",
    "4": "Highlight colour 4",
    "5": "Highlight colour 5",
    n: "Note",
  }),
  ...group("Text", 12, "always", {
    "+": "Larger text or zoom in",
    "-": "Smaller text or zoom out",
    "0": "Default size or zoom",
  }),
  ...group("Fixed formats", 13, "always", {
    p: "Page strip",
    w: "Fit width or page",
  }),
  ...group("Search", 14, "always", {
    "/": "Search in the book",
    "mod f": "Search in the book",
  }),
  ...group("Look up", 15, "selection", { d: "Look up" }),
  ...group("Read aloud", 19, "always", {
    a: "Start, pause or resume",
    ",": "Previous sentence",
    ".": "Next sentence",
  }),
  ...group("Plugins", 4, "selection", { q: "Selection action" }).map(
    (item) => ({ ...item, plugin: true }),
  ),
  ...group("Scrubber", 10, "widget", {
    arrowleft: "Preview 1% earlier",
    arrowright: "Preview 1% later",
    "shift arrowleft": "Preview 10% earlier",
    "shift arrowright": "Preview 10% later",
    home: "Preview start",
    end: "Preview end",
    enter: "Jump to preview",
    escape: "Cancel preview",
  }),
];
export const readerKey = (
  key: string,
  context: ReaderShortcut["context"] = "always",
) => READER_KEYMAP.find((item) => item.key === key && item.context === context);
