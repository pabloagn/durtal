import { describe, expect, it } from "vitest";
import {
  assertionAssessmentSchema,
  assertionScopeSchema,
  assertionTruth,
  canUseAssertionAt,
  sameAssertionScope,
  unresolvedTextScope,
} from "@/lib/enrichment/assertion-scope";

const scope = (value: Record<string, unknown>) => assertionScopeSchema.parse({ version: 1, ...value });
const sourceA = "00000000-0000-4000-8000-000000000001";
const sourceB = "00000000-0000-4000-8000-000000000002";

describe("assertion contract 1", () => {
  it("keeps the French Work baseline separate from an English translation and publication", () => {
    const french = scope({ kind: "work", identityKey: "urn:fixture:kindly-ones:2006", languages: ["fr"], textKind: "original" });
    const english = scope({ kind: "text", identityKey: "urn:fixture:kindly-ones:english", languages: ["en"], textKind: "translation" });
    const publication = scope({ kind: "edition" });
    expect(canUseAssertionAt(english, french)).toBe(false);
    expect(sameAssertionScope(french, publication, null, sourceA)).toBe(false);
    expect(sameAssertionScope(publication, publication, sourceA, sourceB)).toBe(false);
    expect(sameAssertionScope(publication, publication, sourceA, sourceA)).toBe(true);
    expect(canUseAssertionAt(publication, publication)).toBe(false);
    expect(canUseAssertionAt(publication, publication, sourceA, sourceB)).toBe(false);
    expect(canUseAssertionAt(publication, publication, sourceA, sourceA)).toBe(true);
    expect(() => scope({ ...english, kind: "work" })).toThrow("translation");
  });

  it("keeps Labyrinths' English selection, source works, individual pieces and added preface distinct", () => {
    const collection = scope({ kind: "work", identityKey: "urn:fixture:labyrinths:1962", languages: ["en"], textKind: "original" });
    const piece = scope({
      kind: "component",
      identityKey: "urn:fixture:piece:translation",
      languages: ["en"],
      textKind: "translation",
      componentKey: "urn:fixture:piece",
      componentKind: "independent_work",
    });
    const original = scope({ ...piece, identityKey: "urn:fixture:piece:original", languages: ["es"], textKind: "original" });
    const introduction = scope({ ...piece, componentKey: "urn:fixture:preface", componentKind: "augmenting_work" });
    for (const pair of [
      [collection, piece],
      [piece, original],
      [piece, introduction],
    ])
      expect(canUseAssertionAt(pair[0], pair[1])).toBe(false);
    // Different predicates cannot accidentally qualify one another, even on the same text.
    expect(sameAssertionScope(piece, scope({ ...piece, relation: "mentions" }))).toBe(false);
  });

  it("anchors unknown translations to their own source without guessing identity or language", () => {
    const unknown = unresolvedTextScope(sourceA);
    expect(unknown).toMatchObject({ identityKey: null, languages: [], unresolvedSourceId: sourceA, textKind: "unknown" });
    expect(sameAssertionScope(unknown, unresolvedTextScope(sourceB))).toBe(false);
    expect(canUseAssertionAt(unknown, unknown)).toBe(false);
    expect(() => scope({ kind: "text", languages: ["en"] })).toThrow("unidentified");
  });

  it("canonicalizes language order and refuses unknown fields or unsupported versions", () => {
    const a = scope({ kind: "text", identityKey: "urn:fixture:parallel", languages: ["fr", "en", "en"] });
    expect(a.languages).toEqual(["en", "fr"]);
    expect(() => scope({ ...a, version: 2 })).toThrow();
    expect(() => scope({ ...a, random: true })).toThrow();
  });

  it("keeps knowledge separate from review and never makes absence from partial coverage", () => {
    const partial = assertionAssessmentSchema.parse({
      knowledge: "partially_assessed",
      coverage: "partial",
      basis: "local_evidence",
      justification: "One cited passage.",
    });
    expect(assertionTruth(partial, "accepted")).toBeNull();
    expect(assertionTruth(null, "accepted")).toBeNull();
    expect(assertionTruth({ ...partial, knowledge: "present" }, "proposed")).toBeNull();
    expect(assertionTruth({ ...partial, knowledge: "present" }, "rejected")).toBeNull();
    expect(assertionTruth({ ...partial, knowledge: "present" }, "accepted")).toBe(true);
    expect(() => assertionAssessmentSchema.parse({ ...partial, knowledge: "established_absent" })).toThrow("complete examination");
    const absent = assertionAssessmentSchema.parse({ ...partial, knowledge: "established_absent", coverage: "complete", basis: "complete_reading" });
    expect(assertionTruth(absent, "accepted")).toBe(false);
    expect(assertionTruth({ ...absent, knowledge: "disputed" }, "accepted")).toBeNull();
  });
});
