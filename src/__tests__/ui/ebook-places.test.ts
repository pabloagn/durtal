import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EbookPlaces } from "@/components/ebooks/ebook-places";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
import type { ContinueAnchor, ContinueDescriptor } from "@/lib/ebooks/continue-target";
import { ebookFileKey } from "@/lib/ebooks/keys";

// Reading places, one row per device (SLN-665).
const ebookId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const device = (n: number) => `${String(n).padStart(8, "0")}-3333-4333-8333-333333333333`;
const place = (n: number, label: string, total: number, file = fileId): ContinueAnchor => ({
  deviceId: device(n), deviceLabel: label, fileId: file, chapter: n === 1 ? "Chapter II" : null,
  locator: { v: 1, fileHash: "a".repeat(64), href: "chapter", sectionIndex: 1, progression: 0.5, totalProgression: total },
  clientUpdatedAt: new Date(Date.now() - n * 3_600_000).toISOString(),
} as ContinueAnchor);
const files = [{ id: fileId, ebookId, format: "epub", status: "stored", drm: null, s3Key: ebookFileKey("a".repeat(64), "epub"), sha256: "a".repeat(64), sizeBytes: 1000, metadata: {} }];
function render(devices: ContinueAnchor[], deviceCount: number, allDevices = false) {
  const ebook = { id: ebookId, files, positions: devices, places: { devices, deviceCount } } as unknown as EbookDetail;
  const descriptor = { anchor: devices[0] ?? null } as ContinueDescriptor;
  return renderToStaticMarkup(createElement(EbookPlaces, { ebook, descriptor, returnTo: `/ebooks/${ebookId}`, allDevices }));
}

describe("Reading places", () => {
  it("shows each device's newest place, and marks the one Read opens", () => {
    const html = render([place(1, "Mac · Firefox", 0.42), place(2, "iPhone · Safari", 0.3)], 2);
    expect(html).toContain("Reading places");
    expect(html).toContain("Read opens at 42% · Chapter II, from Mac · Firefox.");
    expect(html).toContain("Mac · Firefox");
    expect(html).toContain("42% · Chapter II");
    expect(html.match(/Opens next/g)).toHaveLength(1);
    expect(html).toContain(`/reader/${ebookId}?file=${fileId}&amp;from=${device(2)}`);
    expect(html).not.toContain("Show all");
  });
  it("shows the newest five and links the rest", () => {
    const html = render([1, 2, 3, 4, 5].map((n) => place(n, `Device ${n}`, 0.5)), 41);
    expect(html).toContain("Show all 41 devices");
    expect(html).toContain(`/ebooks/${ebookId}?places=all#places`);
    expect(render([1, 2, 3, 4, 5, 6].map((n) => place(n, `Device ${n}`, 0.5)), 6, true)).toContain("Show the newest five");
  });
  it("opens a replaced file's place in the current file", () => {
    const html = render([place(1, "Mac", 0.5, "44444444-4444-4444-8444-444444444444")], 1);
    expect(html).toContain("Earlier file · opens in the current file");
    expect(html).toContain(`/reader/${ebookId}?from=${device(1)}`);
  });
  it("says when no device has opened it", () => {
    expect(render([], 0)).toContain("Not opened on any device yet.");
  });
});
