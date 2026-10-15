// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ContentViewer } from "@/components/reader/content-viewer";

// The reader's policy lets images load from blob: but not fetch() them
// (connect-src 'self'), so the viewer must show a book image without fetching it
let root: Root | null = null;
let host: HTMLElement;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

async function open(src: string) {
  const page = document.createElement("img");
  page.src = src;
  document.body.append(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ContentViewer, {
      media: { kind: "image", element: page, caption: "Page 3", reference: page },
      onClose: () => {},
    }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("ContentViewer", () => {
  it("shows a book image from its own blob URL without fetching it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
    await open("blob:http://localhost/page-3");
    expect(fetchSpy).not.toHaveBeenCalled();
    const shown = host.querySelector("dialog img");
    expect(shown?.getAttribute("src")).toBe("blob:http://localhost/page-3");
    expect(shown?.getAttribute("alt")).toBe("Page 3");
    expect(host.querySelector("[role=alert]")).toBeNull();
  });

  it("says the image could not be opened instead of the browser's error", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("EncodingError: bad image"));
    await open("blob:http://localhost/broken");
    expect(host.querySelector("[role=alert]")?.textContent).toBe("This image could not be opened.");
    expect(host.textContent).not.toContain("EncodingError");
  });
});
