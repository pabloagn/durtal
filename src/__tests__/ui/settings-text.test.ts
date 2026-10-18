// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/actions/settings", () => ({ refreshCachedData: vi.fn() }));
vi.mock("@/lib/actions/reading-export", () => ({ getGoodreadsExportNotice: vi.fn() }));
import { ExportRow } from "@/app/(catalogue)/settings/data/data-actions";
import { useAppSettings } from "@/lib/hooks/use-app-settings";

/*
 * Settings text (SLN-924): a proper noun keeps its capital, apostrophes are
 * typographic, and a new copy has no condition until one is chosen.
 */

const downloadName = (entity: "works" | "goodreads", label: string) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(ExportRow, { entity, label, description: "" }));
  return host.querySelector('button[aria-label^="Download"]')?.getAttribute("aria-label");
};

it("keeps Goodreads' capital in the download button's name", () => {
  expect(downloadName("goodreads", "Goodreads file")).toBe("Download Goodreads file");
  expect(downloadName("works", "Books")).toBe("Download books");
});

it("writes apostrophes as ’ in the settings text", () => {
  for (const [file, text] of [
    ["src/app/(catalogue)/settings/reading/reading-settings.tsx", "Days I’d like to read each week"],
    ["src/app/(catalogue)/settings/data/page.tsx", "Goodreads’ own export format"],
    ["src/components/reader/presentation-settings-dialog.tsx", "Book’s value"],
  ]) expect(readFileSync(file, "utf8")).toContain(text);
  expect(readFileSync("src/app/(catalogue)/settings/reading/reading-settings.tsx", "utf8")).not.toContain("Saved the timer's question");
});

it("starts a new copy with no condition", () => {
  function Default() { return createElement("span", null, String(useAppSettings().newCopyCondition)); }
  expect(renderToStaticMarkup(createElement(Default))).toBe("<span>null</span>");
  expect(readFileSync("src/lib/actions/settings.ts", "utf8")).toMatch(/newCopyCondition: null,/);
});
