import { describe, expect, it } from "vitest";
import { imagePolicy } from "@/lib/media/policy";
import { imageEditorPolicy } from "@/lib/media/editor-policy";
import type { MediaEntityType } from "@/lib/s3/keys";
import type { WorkKind } from "@/lib/catalogue/kinds";

const image = {
  s3Key: "gold/media/fixture/full.webp",
  thumbnailS3Key: null,
  width: 1600,
  height: 800,
  cropX: 0,
  cropY: 100,
  cropZoom: 200,
  altText: null,
};

describe("owner-bound image editor crop capability", () => {
  it.each<[MediaEntityType, WorkKind | null, number]>([
    ["work", "perfume", 1],
    ["perfume_variant", null, 1],
    ["organization", null, 1],
    ["work", "painting", 2],
    ["art_object", null, 2],
  ])(
    "keeps %s/%s whole despite poster type and legacy crop fields",
    (type, kind, aspect) => {
      const policy = imagePolicy({ type, kind }, "poster");
      expect(imageEditorPolicy(policy, "poster", image)).toEqual({
        supportsCrop: false,
        aspect,
        fit: "contain",
      });
    },
  );
  it.each<[MediaEntityType, WorkKind | null]>([
    ["work", "book"],
    ["work", "film"],
    ["author", null],
    ["collection", null],
  ])("retains portrait cropping for %s/%s", (type, kind) => {
    expect(
      imageEditorPolicy(imagePolicy({ type, kind }, "poster"), "poster", image),
    ).toEqual({ supportsCrop: true, aspect: 2 / 3, fit: "cover" });
  });
  it("keeps person gallery contained and backgrounds framed, with monochrome policy", () => {
    const gallery = imagePolicy({ type: "author" }, "gallery");
    expect(gallery.monochrome).toBe(true);
    expect(imageEditorPolicy(gallery, "gallery", image)).toEqual({
      supportsCrop: false,
      aspect: 2,
      fit: "contain",
    });
    expect(
      imageEditorPolicy(
        imagePolicy({ type: "author" }, "background"),
        "background",
        image,
      ),
    ).toEqual({ supportsCrop: true, aspect: 16 / 9, fit: "cover" });
  });
});
