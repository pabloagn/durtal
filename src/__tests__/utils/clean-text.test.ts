import { describe, expect, it } from "vitest";
import { cleanText } from "@/lib/utils/clean-text";
import { createWorkSchema } from "@/lib/validations/works";
import { createAuthorSchema } from "@/lib/validations/authors";
import { createEditionSchema } from "@/lib/validations/editions";
import { seriesInputSchema } from "@/lib/validations/series";
import { wizardBookSchema } from "@/lib/validations/wizard";

// SLN-1393: a title or name pasted with invisible characters is stored without them
describe("cleanText", () => {
  it("strips each invisible format character and leaves the text otherwise as typed", () => {
    for (const hidden of ["\u00ad", "\u200b", "\u200e", "\u200f", "\u202a", "\u202e", "\u2060", "\u2066", "\u2069", "\ufeff"])
      expect(cleanText(`Ver${hidden}schwinden`), JSON.stringify(hidden)).toBe("Verschwinden");
    expect(cleanText("  À rebours, ﬁn  ")).toBe("  À rebours, ﬁn  ");
  });

  it("keeps the joiners Persian, Indic scripts and emoji need, and the Mongolian vowel separator", () => {
    expect(cleanText("می\u200cخواهم")).toBe("می\u200cخواهم");
    expect(cleanText("क्\u200dष")).toBe("क्\u200dष");
    expect(cleanText("\u182a\u1820\u1822\u180e\u1820")).toBe("\u182a\u1820\u1822\u180e\u1820");
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

  // Review of #576: the wizard's author was trimmed only, so a zero-width space passed
  it("refuses a wizard author made only of invisible characters, and cleans a real one", () => {
    const work = { title: "Doctor Faustus" }, edition = { title: "Doctor Faustus" };
    const refused = wizardBookSchema.safeParse({ authorName: "\u200b", work, edition });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.message)).toContain("Author is required");
    expect(wizardBookSchema.parse({ authorName: "Thomas\u00ad Mann\u200b", work, edition }).authorName).toBe("Thomas Mann");
  });
});
