import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// SLN-1330: a delete from the record's own page goes to the list in the
// action's one response. Answering the page instead re-rendered the deleted
// record as "Page not found" before the tab left.
const nav = vi.hoisted(() => ({ redirect: vi.fn((to: string, type: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;${type};${to};307;` }); }) }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect, RedirectType: { push: "push", replace: "replace" } }));
const collections = vi.hoisted(() => ({ deleteCollection: vi.fn() }));
vi.mock("@/lib/actions/collections", () => collections);
const series = vi.hoisted(() => ({ deleteSeries: vi.fn() }));
vi.mock("@/lib/actions/series", () => series);

import { deleteCollectionFromPage, deleteSeriesFromPage } from "@/lib/actions/catalogue-ui";
import * as client from "@/lib/actions/catalogue-client";
import { ExpectedActionError } from "@/lib/actions/expected-error";

afterEach(() => vi.clearAllMocks());

describe("a delete from the record's page", () => {
  it("redirects to its list, replacing the deleted page in the history", async () => {
    series.deleteSeries.mockResolvedValue({ id: "s" });
    await expect(deleteSeriesFromPage("s")).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/series;307;" });
    expect(nav.redirect).toHaveBeenCalledWith("/series", "replace");
  });

  it("stays with a refusal's reason", async () => {
    series.deleteSeries.mockRejectedValue(new ExpectedActionError("This series no longer exists"));
    expect(await deleteSeriesFromPage("s")).toEqual({ ok: false, error: "This series no longer exists" });
    expect(nav.redirect).not.toHaveBeenCalled();
  });

  it("stays when the page must still say something, such as artwork left to clean up", async () => {
    collections.deleteCollection.mockResolvedValue({ id: "c", cleanupPending: true });
    expect(await deleteCollectionFromPage("c")).toEqual({ ok: true, value: { id: "c", cleanupPending: true } });
    collections.deleteCollection.mockResolvedValue({ id: "c", cleanupPending: false });
    await expect(deleteCollectionFromPage("c")).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/collections;307;" });
  });

  it("on the client, reads the redirect as done and a refusal as a refusal", async () => {
    series.deleteSeries.mockResolvedValue({ id: "s" });
    expect(await client.deleteSeriesFromPage("s")).toBeNull();
    series.deleteSeries.mockRejectedValue(new ExpectedActionError("This series no longer exists"));
    await expect(client.deleteSeriesFromPage("s")).rejects.toMatchObject({ name: "ActionRefusal", message: "This series no longer exists" });
  });
});

describe("a navigation", () => {
  const SRC = path.resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "__tests__" ? [] : files(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });

  it("is never followed by a refresh, which renders the new page twice", () => {
    const found = files(SRC).flatMap((file) => {
      const lines = readFileSync(file, "utf8").split("\n");
      return lines.flatMap((line, i) =>
        /^\s*router\.(push|replace)\(/.test(line) && /^\s*router\.refresh\(\)/.test(lines[i + 1] ?? "") ? [`${path.relative(SRC, file)}:${i + 1}`] : [],
      );
    });
    expect(found).toEqual([]);
  });

  it("is not made after a delete the record's page now leaves by", () => {
    const pages = [
      "components/collections/collection-controls.tsx",
      "components/films/film-actions.tsx",
      "app/(catalogue)/library/[slug]/work-actions-menu.tsx",
      "components/organizations/organization-actions.tsx",
      "components/paintings/painting-actions.tsx",
      "app/(catalogue)/people/[slug]/author-detail-header.tsx",
      "components/perfumes/perfume-actions.tsx",
      "app/(catalogue)/places/[slug]/venue-actions.tsx",
      "app/(catalogue)/recommenders/[id]/recommender-actions.tsx",
      "components/series/series-actions.tsx",
    ];
    for (const page of pages) expect(readFileSync(path.join(SRC, page), "utf8"), page).toMatch(/\w+FromPage\(/);
  });
});
