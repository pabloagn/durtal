import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/collections", () => ({ setCollectionIcon: vi.fn() }));
import { CollectionIconPicker } from "@/components/collections/collection-icon-picker";

// SLN-914: with no icon chosen the picker shows the name's letter. A name
// with no letter or digit ("★★★") must still show a mark, never an empty button.
describe("Collection icon picker with no icon", () => {
  const button = (name: string) =>
    renderToStaticMarkup(createElement(CollectionIconPicker, { collectionId: "c", name, value: null }));

  it("shows the name's letter", () => {
    expect(button("Gothic shelf")).toMatch(/>G<\/span>/);
  });

  it("shows a mark when the name has no letter or digit", () => {
    const html = button("★★★");
    expect(html).not.toMatch(/<span[^>]*><\/span>/);
    expect(html).toMatch(/<svg/);
  });
});
