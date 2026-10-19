import { describe, expect, it } from "vitest";
import { cleanText } from "@/lib/utils/clean-text";
import { createWorkSchema } from "@/lib/validations/works";
import { createAuthorSchema } from "@/lib/validations/authors";
import { createEditionSchema } from "@/lib/validations/editions";
import { seriesInputSchema } from "@/lib/validations/series";

// SLN-1393: a title or name pasted with invisible characters is stored without them
describe("cleanText", () => {
  it("strips each invisible format character and leaves the text otherwise as typed", () => {
    for (const hidden of ["\u00ad", "\u180e", "\u200b", "\u200e", "\u200f", "\u202a", "\u202e", "\u2060", "\u2066", "\u2069", "\ufeff"])
      expect(cleanText(`Ver${hidden}schwinden`), JSON.stringify(hidden)).toBe("Verschwinden");
    expect(cleanText("  À rebours, ﬁn  ")).toBe("  À rebours, ﬁn  ");
  });

  it("keeps the joiners Persian, Indic scripts and emoji need", () => {
    expect(cleanText("می\u200cخواهم")).toBe("می\u200cخواهم");
    expect(cleanText("क्\u200dष")).toBe("क्\u200dष");
  });

  it("composes decomposed letters", () => {
    expect(cleanText("Cafe\u0301")).toBe("Café");
  });
});

describe("titles and names saved through the app", () => {
  const author = "00000000-0000-4000-8000-000000000001";
  it("are stored without the invisible characters", () => {
    expect(createWorkSchema.parse({ title: "Das Ver\u00adschwinden", seriesName: "\ufeffLa Comédie", authorIds: [{ authorId: author }] }))
      .toMatchObject({ title: "Das Verschwinden", seriesName: "La Comédie" });
    expect(createAuthorSchema.parse({ name: "Peter\u200b Handke" }).name).toBe("Peter Handke");
    expect(createEditionSchema.parse({ workId: "00000000-0000-4000-8000-000000000001", title: "Swann\u00ad's Way", subtitle: "A\u200e Novel" }))
      .toMatchObject({ title: "Swann's Way", subtitle: "A Novel" });
    expect(seriesInputSchema.parse({ title: " \u00adThe Durtal Cycle " }).title).toBe("The Durtal Cycle");
  });

  it("refuse a title that is only invisible characters", () => {
    const result = createWorkSchema.safeParse({ title: "\u00ad\u200b", authorIds: [{ authorId: author }] });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["Title is required"]);
  });
});
