import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { lifeDates, lifeEvent } from "@/lib/utils/format";

// SLN-1006: the person page wrote "1848 - 1907" and "1950 - " for the living,
// the cards "1848–1907" with no "c.", and a death year alone showed nowhere.
// One helper now gives the page, the cards, the rows, the map and the
// timeline the same text.

describe("lifeDates", () => {
  it("joins both years with an en dash", () => {
    expect(lifeDates({ birthYear: 1848, deathYear: 1907 })).toBe("1848–1907");
  });

  it("says born for the living and died when only the death is known", () => {
    expect(lifeDates({ birthYear: 1950, deathYear: null })).toBe("b. 1950");
    expect(lifeDates({ birthYear: null, deathYear: 1890 })).toBe("d. 1890");
  });

  it("marks an approximate year, on either side", () => {
    expect(lifeDates({ birthYear: 1450, deathYear: 1500, birthYearIsApproximate: true, deathYearIsApproximate: true })).toBe("c. 1450–c. 1500");
    expect(lifeDates({ birthYear: 1450, deathYear: 1500, birthYearIsApproximate: true })).toBe("c. 1450–1500");
    expect(lifeDates({ birthYear: 1450, birthYearIsApproximate: true })).toBe("b. c. 1450");
  });

  it("writes years before the common era as BC", () => {
    expect(lifeDates({ birthYear: -70, deathYear: -19 })).toBe("70 BC–19 BC");
  });

  it("is null with neither year, and never prints a question mark", () => {
    expect(lifeDates({})).toBeNull();
    expect(lifeDates({ birthYear: null, deathYear: null })).toBeNull();
    for (const birthYear of [null, 1900])
      for (const deathYear of [null, 1950])
        expect(lifeDates({ birthYear, deathYear }) ?? "").not.toContain("?");
  });
});

describe("lifeEvent", () => {
  it("gives the full date and the place when they are known", () => {
    expect(lifeEvent({ year: 1848, month: 2, day: 5, place: "Paris" })).toBe("5 February 1848, Paris");
    expect(lifeEvent({ year: 1907, month: 5, day: 12, place: "Paris" })).toBe("12 May 1907, Paris");
  });

  it("is as precise as the record", () => {
    expect(lifeEvent({ year: 1907, month: 5 })).toBe("May 1907");
    expect(lifeEvent({ year: 1907 })).toBe("1907");
    expect(lifeEvent({ year: 1907, place: "Paris" })).toBe("1907, Paris");
    expect(lifeEvent({ place: "Paris" })).toBe("Paris");
    expect(lifeEvent({ year: null, month: null, day: null, place: null })).toBeNull();
    expect(lifeEvent({ place: "  " })).toBeNull();
  });

  it("claims no month or day on an approximate year", () => {
    expect(lifeEvent({ year: 1450, month: 3, day: 1, approximate: true })).toBe("c. 1450");
  });
});

const SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

it("leaves no copy of the life-dates text outside lifeDates", () => {
  const copy = /`[^`\n]*birthYear[^`\n]*deathYear[^`\n]*`|(birth|death)Year \?\? "\?"/;
  const helper = path.join(SRC, "lib/utils/format.ts");
  const copies = sourceFiles(SRC)
    .filter((file) => file !== helper && copy.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file));
  expect(copies).toEqual([]);
});

it("gives the person page a Born and a Died line with places", () => {
  const page = readFileSync(path.join(SRC, "app/(catalogue)/people/[slug]/page.tsx"), "utf8");
  expect(page).toContain("lifeDates={lifeDates(author)}");
  expect(page).toContain('label: "Born"');
  expect(page).toContain('label: "Died"');
  const actions = readFileSync(path.join(SRC, "lib/actions/authors.ts"), "utf8");
  const bySlug = actions.slice(actions.indexOf("export async function getAuthorBySlug"));
  expect(bySlug.slice(0, bySlug.indexOf("withSafeBio"))).toMatch(/birthPlace:[\s\S]*deathPlace:/);
});
