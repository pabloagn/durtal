import { afterEach, describe, expect, it, vi } from "vitest";
import { copyBookText, formatBookClipboardText } from "@/lib/utils/copy-book";

afterEach(() => vi.unstubAllGlobals());
describe("copy book title and author", () => {
  it.each([
    ["Fictions", ["Jorge Luis Borges"], "Fictions, Jorge Luis Borges"],
    ["Éloge de l’ombre", ["Jun’ichirō Tanizaki"], "Éloge de l’ombre, Jun’ichirō Tanizaki"],
    ["Good Omens", ["Terry Pratchett", "Neil Gaiman"], "Good Omens, Terry Pratchett & Neil Gaiman"],
    [" Title ", [" Author ", "Author", ""], "Title, Author"],
    ["Anonymous work", [], "Anonymous work"],
  ])("formats %s as plain text", (title, authors, expected) => {
    expect(formatBookClipboardText(title, authors)).toBe(expected);
  });
  it("writes the exact text with one clipboard call", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyBookText("Fictions", ["Jorge Luis Borges"]);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Fictions, Jorge Luis Borges");
  });
  it("propagates denied access so the UI can report failure", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await expect(copyBookText("Fictions", ["Jorge Luis Borges"])).rejects.toThrow("denied");
  });
  it("reports unavailable clipboard support", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyBookText("Fictions", ["Jorge Luis Borges"])).rejects.toThrow("Clipboard unavailable");
  });
});
