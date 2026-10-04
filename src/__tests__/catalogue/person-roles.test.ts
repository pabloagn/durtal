import { describe, expect, it } from "vitest";
import { formatPersonRoles } from "@/lib/catalogue/person-roles";

describe("a person card's role line (SLN-420)", () => {
  it("shows nothing for a person with no credits, never Unknown", () => {
    expect(formatPersonRoles([])).toBeNull();
    expect(formatPersonRoles(undefined)).toBeNull();
  });

  it("puts the role with the most credits first, shows two, then +N", () => {
    expect(
      formatPersonRoles([
        { kind: "book", label: "Translator", count: 3 },
        { kind: "book", label: "Author", count: 12 },
        { kind: "book", label: "Editor", count: 1 },
      ]),
    ).toEqual({ text: "Author · Translator +1", full: "Author, Translator, Editor" });
    expect(formatPersonRoles([{ kind: "film", label: "Director", count: 2 }])).toEqual({
      text: "Director",
      full: "Director",
    });
  });

  it("puts the open collection's roles first", () => {
    const roles = [
      { kind: "book" as const, label: "Author", count: 12 },
      { kind: "film" as const, label: "Screenwriter", count: 1 },
    ];
    expect(formatPersonRoles(roles)?.text).toBe("Author · Screenwriter");
    expect(formatPersonRoles(roles, "film")?.text).toBe("Screenwriter · Author");
  });

  it("puts a filtered role first, so the line shows why the person is listed", () => {
    const cocteau = [
      { roleId: "book.author", kind: "book" as const, label: "Author", count: 20 },
      { roleId: "film.cast", kind: "film" as const, label: "Cast", count: 6 },
      { roleId: "film.screenwriter", kind: "film" as const, label: "Screenwriter", count: 4 },
      { roleId: "film.director", kind: "film" as const, label: "Director", count: 3 },
    ];
    expect(formatPersonRoles(cocteau)?.text).toBe("Author · Cast +2");
    expect(formatPersonRoles(cocteau, null, ["film.director"])?.text).toBe("Director · Author +2");
    // Before the open collection's roles too
    expect(formatPersonRoles(cocteau, "film", ["film.director"])?.text).toBe("Director · Cast +2");
  });

  it("names one label once across collections", () => {
    expect(
      formatPersonRoles([
        { kind: "book", label: "Editor", count: 2 },
        { kind: "film", label: "Editor", count: 1 },
      ]),
    ).toEqual({ text: "Editor", full: "Editor" });
  });
});
