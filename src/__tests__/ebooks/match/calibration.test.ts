import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Global database forbidden");
      },
    },
  ),
}));
import {
  MATCH_TABLES,
  dataFingerprint,
  type LoadedMatchCatalogue,
} from "@/lib/ebooks/match/load";
import {
  requireCalibration,
  scoreCalibration,
  scoreNewGroups,
  scoringInputFingerprint,
  wilson95,
} from "@/lib/ebooks/match/calibration";
import { catalogue, ebook } from "./fixtures";

function loaded(): LoadedMatchCatalogue {
  return {
    catalogue: catalogue(),
    rows: Object.fromEntries(
      MATCH_TABLES.map((table) => [table, []]),
    ) as unknown as LoadedMatchCatalogue["rows"],
    catalogueFingerprint: "a".repeat(64),
    inputFingerprint: "b".repeat(64),
  };
}
const inputPlan = "c".repeat(64);
describe("source-bound precision evidence", () => {
  it("requires real complete labels and preserves unknown cases pending", () => {
    const scoring = scoreNewGroups(loaded(), [ebook()], inputPlan);
    expect(() => scoreCalibration(scoring.binding, scoring.sample, [])).toThrow(
      "complete distinct sample",
    );
    const unknown = scoreNewGroups(
      loaded(),
      [ebook({ title: "Unknown title", authors: ["Unknown"] })],
      inputPlan,
    );
    expect(unknown.results[0]).toMatchObject({
      tier: "not_in_durtal",
      autoLink: false,
    });
  });
  it("recomputes precision/uncertainty and rejects stale model/catalogue/input/plan/candidate bindings", () => {
    const scoring = scoreNewGroups(loaded(), [ebook()], inputPlan);
    const receipt = scoreCalibration(
      scoring.binding,
      scoring.sample,
      scoring.sample.map((row) => ({
        ebookId: row.ebookId,
        fingerprint: row.fingerprint,
        tier: row.tier!,
        label: "right",
      })),
    );
    expect(() =>
      requireCalibration(receipt, scoring.binding, scoring.sample),
    ).not.toThrow();
    expect(receipt.automatic).toMatchObject({
      n: 1,
      right: 1,
      precision: 1,
      wrongWork: 0,
    });
    expect(receipt.automatic.lower95).toBeLessThan(0.5);
    for (const field of [
      "modelFingerprint",
      "catalogueFingerprint",
      "inputFingerprint",
      "externalInputFingerprint",
      "inputPlanSha256",
      "candidateFingerprint",
    ] as const)
      expect(() =>
        requireCalibration(
          receipt,
          { ...scoring.binding, [field]: "d".repeat(64) },
          scoring.sample,
        ),
      ).toThrow("labelled precision");
  });
  it.each(["wrong_work", "wrong_edition"] as const)(
    "refuses automatic precision with %s",
    (label) => {
      const scoring = scoreNewGroups(loaded(), [ebook()], inputPlan);
      const receipt = scoreCalibration(
        scoring.binding,
        scoring.sample,
        scoring.sample.map((row) => ({
          ebookId: row.ebookId,
          fingerprint: row.fingerprint,
          tier: row.tier!,
          label,
        })),
      );
      expect(() =>
        requireCalibration(receipt, scoring.binding, scoring.sample),
      ).toThrow("labelled precision");
    },
  );
  it("never counts invented or altered sample rows or totals as evidence", () => {
    const scoring = scoreNewGroups(loaded(), [ebook()], inputPlan);
    expect(() =>
      scoreCalibration(scoring.binding, scoring.sample, [
        {
          ebookId: "invented",
          fingerprint: "x",
          tier: "strong",
          label: "right",
        },
      ]),
    ).toThrow("Labels differ");
    const receipt = scoreCalibration(scoring.binding, scoring.sample, [
      {
        ebookId: "ebook-1",
        fingerprint: scoring.sample[0].fingerprint,
        tier: "strong",
        label: "wrong_work",
      },
    ]);
    expect(() =>
      requireCalibration(
        {
          ...receipt,
          automatic: {
            ...receipt.automatic,
            right: 1,
            wrongWork: 0,
            precision: 1,
          },
        },
        scoring.binding,
        scoring.sample,
      ),
    ).toThrow("labelled precision");
  });
  it("includes unregistered groups when detecting shared ISBNs and author-title frequency", () => {
    const groups = ["Nadja", "Fictions", "Ulysses"].map((title, i) =>
      ebook({ id: `group:${i}`, title, isbns: ["9780306406157"] }),
    );
    const scoring = scoreNewGroups(loaded(), groups, inputPlan);
    expect(
      scoring.results.every(
        (row) =>
          row.tier === "conflict" &&
          !row.autoLink &&
          row.flags.includes("shared_isbn"),
      ),
    ).toBe(true);
  });
  it("keeps input evidence stable through registration UUID allocation and preserves multiplicity", () => {
    expect(scoringInputFingerprint([ebook({ id: "group:key" })])).toBe(
      scoringInputFingerprint([ebook({ id: "real-registration-id" })]),
    );
    expect(scoringInputFingerprint([ebook(), ebook({ id: "other" })])).not.toBe(
      scoringInputFingerprint([ebook()]),
    );
    expect(dataFingerprint(wilson95(0, 0))).toBe(dataFingerprint([0, 1]));
  });
});
