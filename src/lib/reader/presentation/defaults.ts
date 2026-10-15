import {
  parseStoredPresentation,
  type DeviceClass,
  type ReaderPresentation,
} from "@/lib/validations/reader-preferences";

const common = {
  font: "literata",
  publisherScale: 100,
  fontWeight: 400,
  lineHeight: 1.5,
  paragraphSpacingEm: null,
  paragraphIndentEm: null,
  letterSpacingEm: 0,
  wordSpacingEm: 0,
  textAlign: "justify",
  hyphenate: true,
  publisherStyles: false,
  flow: "paginated",
  lineLength: "medium",
  pageTurn: "slide",
  pinBars: false,
  theme: "durtal-dark",
  brightness: 100,
  warmth: 0,
  dimImages: false,
  cropMargins: "auto",
  pdfThemePages: true,
} as const;

export const PRESENTATION_DEFAULTS: Readonly<
  Record<DeviceClass, Readonly<ReaderPresentation>>
> = Object.freeze({
  desktop: Object.freeze({
    ...common,
    fontSizePx: 20,
    marginPx: 48,
    edgeTaps: false,
    spread: "auto",
    fixedFit: "page",
  }),
  tablet: Object.freeze({
    ...common,
    fontSizePx: 19,
    marginPx: 40,
    edgeTaps: true,
    spread: "auto",
    fixedFit: "page",
  }),
  phone: Object.freeze({
    ...common,
    fontSizePx: 18,
    marginPx: 16,
    edgeTaps: true,
    spread: "none",
    lineLength: "full",
    fixedFit: "width",
  }),
});

/** Queries supply only the requested book's rows, plus the three defaults. */
export interface PresentationRow {
  deviceClass: DeviceClass;
  ebookId: string | null;
  presentation: unknown;
}

export function effectivePresentation(
  deviceClass: DeviceClass,
  rows: readonly PresentationRow[],
): ReaderPresentation {
  const scoped = (device: DeviceClass) => [
    rows.find((row) => row.deviceClass === device && row.ebookId === null),
    rows.find((row) => row.deviceClass === device && row.ebookId !== null),
  ];
  // Until SLN-686 a laptop was classed as a tablet: its settings carry over to
  // the desktop, field by field, until desktop settings replace them. The rows
  // cannot tell an old laptop from a real tablet, so a real tablet's settings
  // carry over too, on purpose: a desktop with none starts from them.
  const inherited = deviceClass === "desktop" ? scoped("tablet") : [];
  return Object.assign(
    { ...PRESENTATION_DEFAULTS[deviceClass] },
    ...[...inherited, ...scoped(deviceClass)].map((row) => parseStoredPresentation(row?.presentation)),
  );
}

/** Keyboard edits follow the scope that supplies this particular field. */
export function presentationFieldScope(
  field: keyof ReaderPresentation,
  deviceClass: DeviceClass,
  rows: readonly PresentationRow[],
): string | null {
  const book = rows.find(
    (row) => row.deviceClass === deviceClass && row.ebookId !== null,
  );
  return book &&
    Object.hasOwn(parseStoredPresentation(book.presentation), field)
    ? book.ebookId
    : null;
}
