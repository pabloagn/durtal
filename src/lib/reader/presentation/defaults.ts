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
    spread: "auto",
    fixedFit: "page",
  }),
  tablet: Object.freeze({
    ...common,
    fontSizePx: 19,
    marginPx: 40,
    spread: "auto",
    fixedFit: "page",
  }),
  phone: Object.freeze({
    ...common,
    fontSizePx: 18,
    marginPx: 16,
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
  const defaults = rows.find(
    (row) => row.deviceClass === deviceClass && row.ebookId === null,
  );
  const book = rows.find(
    (row) => row.deviceClass === deviceClass && row.ebookId !== null,
  );
  return {
    ...PRESENTATION_DEFAULTS[deviceClass],
    ...parseStoredPresentation(defaults?.presentation),
    ...parseStoredPresentation(book?.presentation),
  };
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
