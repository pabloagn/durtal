import { describe, expect, it, vi } from "vitest";
import { isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SLN-714: when the collections query fails, /collections reaches the
// catalogue's error view; it never says "No collections yet".

const actions = vi.hoisted(() => ({
  getCollections: vi.fn(async () => [] as unknown[]),
  getCollectionCount: vi.fn(async () => 0),
  getCollectionCoverPreviews: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/actions/collections", () => actions);
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/layout/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/shared/favourites-filter", () => ({ FavouritesFilter: () => null }));
vi.mock("@/components/collections/collections-view", () => ({
  CollectionsView: () => null,
  CollectionsViewSwitcher: () => null,
}));
vi.mock("@/app/(catalogue)/collections/create-collection-dialog", () => ({
  CreateCollectionDialog: () => null,
}));

import CollectionsPage from "@/app/(catalogue)/collections/page";

type AsyncPart = (props: unknown) => Promise<ReactNode>;

/** The list part of the page: the async component its Suspense streams */
async function listPart(params: Record<string, string> = {}) {
  // The page first asks whether any collection exists (SLN-842); some do
  actions.getCollectionCount.mockResolvedValueOnce(1);
  const page = await CollectionsPage({ searchParams: Promise.resolve(params) });
  let found: ReactElement<{ children?: ReactNode }> | undefined;
  const walk = (node: ReactNode) => {
    if (found || !isValidElement<{ children?: ReactNode }>(node)) return;
    if (node.type === Suspense) {
      found = node.props.children as ReactElement<{ children?: ReactNode }>;
      return;
    }
    ([] as ReactNode[]).concat(node.props.children).forEach(walk);
  };
  walk(page);
  expect(found, "the page streams its list in a Suspense").toBeTruthy();
  return (found!.type as AsyncPart)(found!.props);
}

describe("/collections when its query fails", () => {
  it("throws the failure to the error view instead of drawing an empty list", async () => {
    actions.getCollections.mockRejectedValueOnce(new Error("relation \"collections\" does not exist"));
    await expect(listPart()).rejects.toThrow('relation "collections" does not exist');
  });

  it("throws when only the count fails", async () => {
    actions.getCollectionCount.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(listPart()).rejects.toThrow("connection terminated");
  });

  it("with no collection at all, is the one empty state, without the list (SLN-842)", async () => {
    const html = renderToStaticMarkup(await CollectionsPage({ searchParams: Promise.resolve({}) }) as ReactElement);
    expect(html).toContain("No collections yet");
    expect(html).toContain("A collection gathers the works you choose");
  });

  it("says No collections yet only when the query answers with none", async () => {
    const html = renderToStaticMarkup(await listPart());
    expect(html).toContain("No collections yet");
  });

  it("offers Clear search when a search matches nothing (SLN-845)", async () => {
    const html = renderToStaticMarkup(await listPart({ q: "zzz", sort: "size" }));
    expect(html).toContain("No collections found");
    expect(html).toContain("No collections match &quot;zzz&quot;.");
    expect(html).toContain("Clear search");
    // Clearing keeps the sort, as on every list
    expect(html).toContain('href="/collections?sort=size"');
    expect(html).not.toContain("No collections yet");
  });
});
