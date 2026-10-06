import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  claimColumns,
  DAILY_EXACT_IDENTITY_APPLY_CAP,
  DAILY_RULE_APPLY_CAP,
  jobError,
  proposalOutcome,
  retryDelayMinutes,
  ruleAppliesLeft,
  ruleCap,
  type SameValueClaim,
} from "@/lib/enrichment/rules";
import { APPLY_TARGETS, NoWriterError, type ApplyContext } from "@/lib/enrichment/targets";
import { APPLY_TARGET_RULES, ENRICHMENT_APPLY_TARGETS, ENRICHMENT_VALUE_KINDS } from "@/lib/enrichment/model";
import { vocabularySeedSchema } from "@/lib/validations/enrichment";

/*
 * SLN-462: the pure rules of the enrichment services, the apply-target
 * registry and the vocabulary seed schema (on the fixture vocabulary).
 */

const fixture = () => JSON.parse(readFileSync("src/__tests__/fixtures/enrichment/vocabulary.json", "utf8"));

describe("value kinds", () => {
  const term = { id: "t", scaleValue: null };
  it("puts each kind's value in its own column", () => {
    expect(claimColumns("terms", { term: "dark" }, term)).toMatchObject({ termId: "t", numberValue: null });
    expect(claimColumns("scale", { term: "slow" }, { id: "s", scaleValue: 1 })).toMatchObject({ termId: "s", numberValue: 1 });
    expect(claimColumns("number", { number: 1951 })).toMatchObject({ numberValue: 1951, termId: null });
    expect(claimColumns("identifier", { text: "Q1" })).toMatchObject({ textValue: "Q1" });
    expect(claimColumns("place", { placeId: "p" })).toMatchObject({ placeId: "p" });
    expect(claimColumns("person", { personId: "a" })).toMatchObject({ personId: "a" });
  });
  it("refuses a value of another kind, and a term without a scale value on a scale", () => {
    expect(() => claimColumns("term", { number: 3 }, term)).toThrow("A term dimension takes a value of its own kind");
    expect(() => claimColumns("scale", { term: "slow" }, term)).toThrow("A scale dimension takes a value of its own kind");
    expect(() => claimColumns("place", { personId: "a" })).toThrow("A place dimension takes a value of its own kind");
  });
});

describe("proposal skip rules", () => {
  const claim = (fields: Partial<SameValueClaim>): SameValueClaim => ({ id: "c", status: "proposed", decisionReason: null, sourceIds: ["s1"], ...fields });
  const outcome = (claims: SameValueClaim[], sourceIds = ["s1"], linked = false) => proposalOutcome({ claims, sourceIds, linked });
  it("creates a new value, and adds a second source to the open claim", () => {
    expect(outcome([])).toEqual({ kind: "create" });
    expect(outcome([claim({ id: "open" })], ["s2"])).toEqual({ kind: "merge", claimId: "open" });
  });
  it("skips a value already accepted or linked, and one rejected for good", () => {
    expect(outcome([claim({ status: "accepted" })]).kind).toBe("skip");
    expect(outcome([], ["s1"], true)).toEqual({ kind: "skip", reason: "already linked" });
    for (const reason of ["wrong_value", "wrong_book"] as const)
      expect(outcome([claim({ status: "rejected", decisionReason: reason })], ["s9"])).toEqual({ kind: "skip", reason: "rejected for good" });
  });
  it("opens a value rejected on its evidence only with a new source", () => {
    for (const reason of ["weak_evidence", "not_independent", "other"] as const) {
      expect(outcome([claim({ status: "rejected", decisionReason: reason })], ["s1"]).kind).toBe("skip");
      expect(outcome([claim({ status: "rejected", decisionReason: reason })], ["s1", "s2"])).toEqual({ kind: "create" });
    }
  });
  it("never lets a withdrawal block the same value from the same sources", () => {
    for (const reason of ["run_undone", "mapping_changed", "vocabulary_changed", "evidence_deleted", "undone"] as const)
      expect(outcome([claim({ status: "rejected", decisionReason: reason })], ["s1"])).toEqual({ kind: "create" });
    expect(outcome([claim({ status: "superseded" })])).toEqual({ kind: "create" });
  });
});

describe("caps and backoff", () => {
  it("counts the daily caps down to zero, exact identity links apart", () => {
    expect(ruleAppliesLeft(0)).toBe(DAILY_RULE_APPLY_CAP);
    expect(ruleAppliesLeft(DAILY_RULE_APPLY_CAP - 1)).toBe(1);
    expect(ruleAppliesLeft(DAILY_RULE_APPLY_CAP + 5)).toBe(0);
    expect([DAILY_RULE_APPLY_CAP, DAILY_EXACT_IDENTITY_APPLY_CAP]).toEqual([20, 100]);
    expect(ruleCap("exact_identifier_match")).toBe(100);
    expect(ruleCap("evaluation_gate")).toBe(20);
    expect(ruleAppliesLeft(30, ruleCap("exact_identifier_match"))).toBe(70);
  });
  it("waits 2^attempts minutes before a retry", () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([2, 4, 8, 16]);
  });
  it("keeps a job's last error short and without keys or query strings", () => {
    const error = jobError(new Error(`GET https://api.example.org/books?key=SECRET failed; token=abc ${"x".repeat(600)}`));
    expect(error).not.toContain("SECRET");
    expect(error).not.toContain("abc");
    expect(error.length).toBeLessThanOrEqual(500);
  });
});

describe("apply targets", () => {
  it("has one target per apply target, accepting the kinds the model gives it", () => {
    expect(Object.keys(APPLY_TARGETS).sort()).toEqual([...ENRICHMENT_APPLY_TARGETS].sort());
    for (const target of ENRICHMENT_APPLY_TARGETS) expect(APPLY_TARGETS[target].kinds).toEqual(APPLY_TARGET_RULES[target].kinds);
    for (const kind of ENRICHMENT_VALUE_KINDS)
      expect(ENRICHMENT_APPLY_TARGETS.some((t) => APPLY_TARGET_RULES[t].kinds.includes(kind)), kind).toBe(true);
  });
  it("refuses a target without a writer, and a measurement", () => {
    for (const target of ["edition.open_library_key", "edition.oclc", "edition.translator"] as const) {
      expect(APPLY_TARGETS[target].writer).toBe(false);
      expect(() => APPLY_TARGETS[target].current({} as ApplyContext)).toThrow(new NoWriterError(`No writer for ${target}`));
    }
    expect(() => APPLY_TARGETS.none.current({} as ApplyContext)).toThrow("Nothing is applied for a measurement");
  });
  const ctx = (fields: Partial<ApplyContext>): ApplyContext => ({
    claimId: "c",
    workId: "w",
    editionId: null,
    dimension: { id: "d", valueKind: "terms", applyTarget: "taxonomy", provider: null, family: null },
    itemId: "i",
    workTypeId: null,
    numberValue: null,
    textValue: null,
    placeId: null,
    personId: null,
    ...fields,
  });
  it("calls a value already there what a rule never replaces", () => {
    const terms = ctx({});
    const scale = ctx({ dimension: { ...terms.dimension, valueKind: "scale" } });
    expect(APPLY_TARGETS.taxonomy.filled({ items: ["other"] }, terms)).toBe(false);
    expect(APPLY_TARGETS.taxonomy.filled({ items: ["i"] }, terms)).toBe(true);
    expect(APPLY_TARGETS.taxonomy.filled({ items: ["other"] }, scale)).toBe(true);
    expect(APPLY_TARGETS.taxonomy.filled({ items: [] }, scale)).toBe(false);
    expect(APPLY_TARGETS["work.original_year"].filled({ value: null }, ctx({}))).toBe(false);
    expect(APPLY_TARGETS["work.original_year"].filled({ value: 1951 }, ctx({}))).toBe(true);
    expect(APPLY_TARGETS.identifier.filled({ id: null, externalId: null }, ctx({}))).toBe(false);
    expect(APPLY_TARGETS.identifier.refuseFilled).toBeTruthy();
    const place = ctx({ dimension: { ...terms.dimension, valueKind: "place", applyTarget: "values" }, placeId: "p" });
    expect(APPLY_TARGETS.values.filled({ rows: [{ place: "q" }] }, place)).toBe(false);
    expect(APPLY_TARGETS.values.filled({ rows: [{ place: "p" }] }, place)).toBe(true);
  });
});

describe("the vocabulary seed", () => {
  it("accepts the fixture vocabulary: every value kind, a system family, an attributes category, a custom family and a tree", () => {
    const seed = vocabularySeedSchema.parse(fixture());
    expect(new Set(seed.dimensions.map((d) => d.valueKind))).toEqual(new Set(ENRICHMENT_VALUE_KINDS));
    expect(seed.dimensions.find((d) => d.family === "attributes")?.attributeCategory).toBe("pace");
    expect(seed.dimensions.some((d) => d.newFamily)).toBe(true);
    expect(seed.dimensions.flatMap((d) => d.terms).some((t) => t.parent)).toBe(true);
  });
  const problems = (change: (seed: ReturnType<typeof fixture>) => void) => {
    const seed = fixture();
    change(seed);
    const result = vocabularySeedSchema.safeParse(seed);
    return result.success ? [] : result.error.issues.map((i) => i.message);
  };
  it("names each problem: examples, anchors, keys, kinds and targets, parameters", () => {
    expect(problems((s) => (s.dimensions[0].terms[1].examples = s.dimensions[0].terms[1].examples.slice(0, 2)))).toContain(
      "dimensions.tone.terms.light: a term needs at least three examples",
    );
    expect(problems((s) => delete s.dimensions[1].terms[0].scaleValue)).toContain("dimensions.pace.terms.slow: a scale point has its value");
    expect(problems((s) => (s.dimensions[2].terms[1].key = "melancholy"))).toContain("dimensions.mood.terms.melancholy: the key is used twice");
    expect(problems((s) => (s.dimensions[3].applyTarget = "work.original_title"))).toContain("dimensions.setting: a place value does not fit work.original_title");
    expect(problems((s) => (s.dimensions[3].parameters = { easierEnd: "low" }))).toContain("dimensions.setting.parameters.easierEnd: only for a scale");
    expect(problems((s) => (s.dimensions[3].parameters = { colour: "red" })).length).toBeGreaterThan(0);
    expect(problems((s) => (s.dimensions[0].parameters = { exclusiveTerms: [["dark", "sunny"]] }))).toContain(
      "dimensions.tone.parameters.exclusiveTerms: sunny is not a term of this dimension",
    );
    expect(problems((s) => (s.dimensions[5].rule = { basis: "exact_identifier_match", minimumConfidence: 1 }))).toContain(
      "dimensions.original_title: a rule needs an eligible dimension",
    );
    expect(problems((s) => (s.dimensions[0].terms[2].parent = "nowhere"))).toContain("dimensions.tone.terms.gothic: its parent is not a term of this dimension");
  });
});
