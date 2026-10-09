import { describe, expect, it } from "vitest";
import { preferredEbookFileSchema } from "@/lib/validations/ebooks";
const id = "5fbb1291-cccb-4e84-b5ca-3f27634bc580";
describe("preferred ebook file input", () => {
  it("accepts canonical ids and strips unrelated properties", () => {
    expect(
      preferredEbookFileSchema.parse({
        ebookId: id,
        fileId: id,
        status: "stored",
      }),
    ).toEqual({ ebookId: id, fileId: id });
  });
  it.each([
    { ebookId: "bad", fileId: id },
    { ebookId: id, fileId: "bad" },
    { ebookId: id },
    {},
  ])("refuses malformed ids before query %#", (input) => {
    expect(preferredEbookFileSchema.safeParse(input).success).toBe(false);
  });
});
