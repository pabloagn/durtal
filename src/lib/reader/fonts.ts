/**
 * The reading fonts inside a book (eBooks sub-issue 3). The book's frames
 * cannot load the app's next/font copies (their names are hashed), so EB
 * Garamond and Inter are served from public/fonts/reader/ under stable names
 * and declared in each section's styles. Each face covers one Unicode range,
 * so a page loads only the files its text needs. Both fonts are OFL 1.1
 * (the licences sit beside the files); taken from Google Fonts on 7 October
 * 2026. Nothing loads from Google Fonts at run time.
 */

/** The family names inside a book */
export const READER_FONT_FAMILIES = {
  serif: '"Durtal EB Garamond"',
  sans: '"Durtal Inter"',
} as const;

type Face = [family: keyof typeof READER_FONT_FAMILIES, style: "normal" | "italic", weight: string, file: string, unicodeRange: string];

const FACES: Face[] = [
  ["serif", "italic", "400 800", "eb-garamond-italic-cyrillic-ext", "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"],
  ["serif", "italic", "400 800", "eb-garamond-italic-cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
  ["serif", "italic", "400 800", "eb-garamond-italic-greek-ext", "U+1F00-1FFF"],
  ["serif", "italic", "400 800", "eb-garamond-italic-greek", "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"],
  ["serif", "italic", "400 800", "eb-garamond-italic-vietnamese", "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB"],
  ["serif", "italic", "400 800", "eb-garamond-italic-latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"],
  ["serif", "italic", "400 800", "eb-garamond-italic-latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
  ["serif", "normal", "400 800", "eb-garamond-normal-cyrillic-ext", "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"],
  ["serif", "normal", "400 800", "eb-garamond-normal-cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
  ["serif", "normal", "400 800", "eb-garamond-normal-greek-ext", "U+1F00-1FFF"],
  ["serif", "normal", "400 800", "eb-garamond-normal-greek", "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"],
  ["serif", "normal", "400 800", "eb-garamond-normal-vietnamese", "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB"],
  ["serif", "normal", "400 800", "eb-garamond-normal-latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"],
  ["serif", "normal", "400 800", "eb-garamond-normal-latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
  ["sans", "italic", "100 900", "inter-italic-cyrillic-ext", "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"],
  ["sans", "italic", "100 900", "inter-italic-cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
  ["sans", "italic", "100 900", "inter-italic-greek-ext", "U+1F00-1FFF"],
  ["sans", "italic", "100 900", "inter-italic-greek", "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"],
  ["sans", "italic", "100 900", "inter-italic-vietnamese", "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB"],
  ["sans", "italic", "100 900", "inter-italic-latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"],
  ["sans", "italic", "100 900", "inter-italic-latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
  ["sans", "normal", "100 900", "inter-normal-cyrillic-ext", "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F"],
  ["sans", "normal", "100 900", "inter-normal-cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
  ["sans", "normal", "100 900", "inter-normal-greek-ext", "U+1F00-1FFF"],
  ["sans", "normal", "100 900", "inter-normal-greek", "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF"],
  ["sans", "normal", "100 900", "inter-normal-vietnamese", "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB"],
  ["sans", "normal", "100 900", "inter-normal-latin-ext", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF"],
  ["sans", "normal", "100 900", "inter-normal-latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
];

/** The @font-face rules, with absolute URLs: a book's frame has its own base URL */
export function readerFontFaces(origin: string): string {
  return FACES.map(
    ([family, style, weight, file, unicodeRange]) =>
      `@font-face{font-family:${READER_FONT_FAMILIES[family]};font-style:${style};font-weight:${weight};` +
      `font-display:swap;src:url("${origin}/fonts/reader/${file}.woff2") format("woff2");unicode-range:${unicodeRange}}`,
  ).join("\n");
}
