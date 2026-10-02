import { describe, expect, it } from "vitest";
import {
  defaultSortName,
  naturalAuthorName,
  naturalNameParts,
} from "@/lib/utils/author-names";

describe("natural author name order", () => {
  it.each([
    ["Huxley, Aldous", "Aldous Huxley"],
    ["García Márquez, Gabriel", "Gabriel García Márquez"],
    ["Tolkien, J. R. R.", "J. R. R. Tolkien"],
    ["  Huxley ,Aldous ", "Aldous Huxley"],
    ["HUXLEY, ALDOUS", "Aldous Huxley"],
    ["de beauvoir, simone", "Simone de Beauvoir"],
    ["O'BRIEN, FLANN", "Flann O'Brien"],
    ["SARTRE, JEAN-PAUL", "Jean-Paul Sartre"],
  ])("%s", (input, expected) => {
    expect(naturalAuthorName(input)).toBe(expected);
  });

  it("leaves names without a name-order comma alone", () => {
    for (const name of [
      "Aldous Huxley",
      "Smith, Jr.",
      "King, III",
      "Sade, Marquis de",
      "Huxley,",
      "Borges, Jorge Luis, and Bioy Casares",
    ])
      expect(naturalAuthorName(name)).toBe(name);
  });

  it("gives the parts for first and last name", () => {
    expect(naturalNameParts("HUXLEY, ALDOUS")).toEqual({
      name: "Aldous Huxley",
      first: "Aldous",
      last: "Huxley",
      sortName: "Huxley, Aldous",
    });
    expect(naturalNameParts("de beauvoir, simone")?.sortName).toBe(
      "de Beauvoir, Simone",
    );
    expect(naturalNameParts("Aldous Huxley")).toBeNull();
  });

  it("keeps the default sort name", () => {
    expect(defaultSortName("Aldous Huxley")).toBe("Huxley, Aldous");
    expect(defaultSortName("Homer")).toBe("Homer");
  });
});
