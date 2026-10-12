import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import type { Presentation } from "../engine";
import core from "./font-core-profile.json";
import { fontFaceCSS, READER_FONT_FILES, readingFontStack } from "./fonts";
import { UNKNOWN_FONT_FACTS, type FontWindowFacts } from "./font-facts";
import { presentationChangeKind } from "./changes";

/** A future reviewed source release, never preferences, book content or a client receipt. */
export interface CoreFontRelease {
  profileId: string;
  manifestSha256: string;
  nativeShapingAccepted: true;
  browserMappingAccepted: true;
  normalTypographyAccepted: true;
  languages: readonly string[];
  policyFontSizes: readonly number[];
  files: readonly { style: "roman" | "italic"; weight: 400 | 700; path: string; sha256: string }[];
}

/** Measurement alone cannot enable the core family or create product asset URLs. */
export const RELEASED_GARAMOND_CORE: CoreFontRelease | null = null;

export interface ReaderFontRoute {
  kind: "standard" | "full" | "core" | "publisher";
  family: string | null;
  reasons: readonly string[];
  /** A known reference envelope, not actual network or first-text acceptance. */
  referenceBytes: number | null;
  firstTextBudgetAccepted: false;
  coreFiles?: CoreFontRelease["files"];
}

export function canPreflightCoreFonts(): boolean {
  return RELEASED_GARAMOND_CORE !== null;
}

function released(release: CoreFontRelease | null): release is CoreFontRelease {
  return !!release && release.profileId === core.id &&
    release.manifestSha256 === core.measuredManifestSha256 &&
    release.nativeShapingAccepted === true && release.browserMappingAccepted === true &&
    release.normalTypographyAccepted === true && release.files.length === 4 &&
    core.files.every(face => release.files.filter(file => file.style === face.style && file.weight === face.weight && file.sha256 === face.sha256).length === 1) &&
    release.files.every(file => /^\/fonts\/reader\/[a-z0-9/_-]+\.woff2$/.test(file.path)) &&
    new Set(release.files.map(file => file.path)).size === 4;
}

export function coreFontEligibility(
  policy: ReaderPresentation,
  facts: FontWindowFacts,
  release: CoreFontRelease | null,
): readonly string[] {
  const reasons = new Set(facts.reasons);
  if (!facts.complete) reasons.add("typography-not-resolved");
  if (policy.fontWeight !== 400) reasons.add("unsupported-preference-weight");
  if (!released(release)) reasons.add("core-shaping-or-publication-unaccepted");
  else {
    if (!release.policyFontSizes.includes(policy.fontSizePx)) reasons.add("unverified-size");
    if (!facts.languages.length || facts.languages.some(language => !release.languages.includes(language))) reasons.add("unverified-language");
  }
  const repertoire = new Set(core.mappedCodepoints);
  if (facts.codepoints.some(point => !repertoire.has(point))) reasons.add("unsupported-glyphs");
  return [...reasons];
}

function standardReference(font: ReaderPresentation["font"]): number {
  const faces = READER_FONT_FILES.filter(face => (face.id === font && face.subset === "latin") || (face.id === "inter" && face.style === "roman" && face.subset === "latin"));
  return faces.reduce((sum, face) => sum + face.bytes, 0);
}

/** Decide before any preload, loader resource replacement, font installation or iframe. */
export function chooseReaderFontRoute(
  policy: ReaderPresentation,
  facts: FontWindowFacts = UNKNOWN_FONT_FACTS,
  options: { fixed?: boolean; release?: CoreFontRelease | null } = {},
): ReaderFontRoute {
  if (options.fixed || policy.publisherStyles || policy.font === "publisher") return {
    kind: "publisher", family: null, reasons: ["publisher-or-fixed-typography"], referenceBytes: null, firstTextBudgetAccepted: false,
  };
  if (policy.font !== "garamond") return {
    kind: "standard", family: readingFontStack(policy.font), reasons: [], referenceBytes: standardReference(policy.font), firstTextBudgetAccepted: false,
  };
  const release = options.release === undefined ? RELEASED_GARAMOND_CORE : options.release;
  const reasons = coreFontEligibility(policy, facts, release);
  if (!reasons.length && released(release)) return {
    kind: "core", family: `"${core.family}", Georgia, serif`, reasons: [], referenceBytes: core.referenceCombinedBytes,
    firstTextBudgetAccepted: false, coreFiles: release.files,
  };
  return { kind: "full", family: readingFontStack("garamond"), reasons, referenceBytes: standardReference("garamond"), firstTextBudgetAccepted: false };
}

/** Selecting one family avoids installing unselected reader families into a book. */
export function routedFontFaces(origin: string, policy: ReaderPresentation, route: ReaderFontRoute): string {
  // Validate the origin even on the publisher path.
  const selected = fontFaceCSS(origin, route.kind === "publisher" ? "publisher" : policy.font);
  if (route.kind !== "core") return selected;
  const base = new URL(origin).origin;
  return (route.coreFiles ?? []).map(file =>
    `@font-face{font-family:"${core.family}";font-style:${file.style === "roman" ? "normal" : "italic"};font-weight:${file.weight};font-display:block;src:url("${base}${file.path}") format("woff2")}`,
  ).join("\n");
}

export function routeFontPresentation(
  presentation: Presentation,
  origin: string,
  facts: FontWindowFacts = UNKNOWN_FONT_FACTS,
  fixed = false,
): Presentation {
  if (!presentation.policy) return presentation;
  const route = chooseReaderFontRoute(presentation.policy, facts, { fixed });
  return { ...presentation, fontRoute: route, fontFamily: route.family, fontFaces: routedFontFaces(origin, presentation.policy, route) };
}

/** A preselected route is not yet an applied renderer stylesheet. */
export function fontPresentationChangeKind(previous: Presentation | null, next: Presentation): "none" | "colour" | "layout" {
  if (!previous?.policy || !next.policy || previous.fontFamily !== next.fontFamily || previous.fontFaces !== next.fontFaces) return "layout";
  return presentationChangeKind(previous.policy, next.policy);
}
