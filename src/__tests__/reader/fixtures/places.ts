import type { ReaderPlace } from "@/lib/reader/sync/places";
export const place = (over: Partial<ReaderPlace> = {}): ReaderPlace => ({
  deviceId: "mac",
  deviceLabel: "Mac · Firefox",
  fileId: "epub",
  thisDevice: true,
  locator: {
    v: 1,
    fileHash: "a".repeat(64),
    href: "chapter.xhtml",
    sectionIndex: 1,
    progression: 0.2,
    totalProgression: 0.4,
  },
  progression: 0.4,
  furthestProgression: 0.4,
  chapter: "Chapter I",
  clientUpdatedAt: "2026-10-09T10:00:00Z",
  ...over,
});
