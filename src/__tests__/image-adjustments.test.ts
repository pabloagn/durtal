import { describe, it, expect } from "vitest";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  imageAdjustmentsSchema,
  imageAdjustmentFilter,
  imageAdjustmentStyles,
  imageSourceIdentity,
  enforceImagePolicy,
  s3ImageSource,
} from "@/lib/utils/image-adjustments";

describe("shared image presentation", () => {
  it("leaves unedited images alone and uses neutral defaults", () => {
    expect(imageAdjustmentStyles([])).toBe("");
    expect(imageAdjustmentFilter(imageAdjustmentsSchema.parse({}))).toBe(
      "brightness(100%) contrast(100%) saturate(100%) grayscale(0%) sepia(0%) blur(0px)",
    );
  });
  it("combines exposure stops with legacy brightness without doubling contrast", () => {
    expect(
      imageAdjustmentFilter({
        ...DEFAULT_IMAGE_ADJUSTMENTS,
        exposure: 1,
        brightness: 120,
        contrast: 130,
      }),
    ).toContain("brightness(240%) contrast(130%)");
    expect(
      imageAdjustmentFilter({ ...DEFAULT_IMAGE_ADJUSTMENTS, exposure: -2 }),
    ).toContain("brightness(25%)");
  });
  it("locks author monochrome through resets and hostile settings", () => {
    const settings = enforceImagePolicy(
      {
        ...DEFAULT_IMAGE_ADJUSTMENTS,
        saturation: 200,
        grayscale: 0,
        sepia: 100,
      },
      true,
    );
    expect(settings).toMatchObject({
      saturation: 100,
      grayscale: 100,
      sepia: 0,
    });
    expect(imageAdjustmentFilter(DEFAULT_IMAGE_ADJUSTMENTS, true)).toContain(
      "grayscale(100%) sepia(0%)",
    );
  });
  it.each([
    { exposure: 3 },
    { brightness: -1 },
    { contrast: 201 },
    { saturation: Infinity },
    { grayscale: NaN },
    { sepia: 101 },
    { softness: 9 },
    { extra: 1 },
  ])("rejects unsupported values %j", (settings) => {
    expect(imageAdjustmentsSchema.safeParse(settings).success).toBe(false);
  });
  it("recognizes only stored asset routes", () => {
    expect(imageSourceIdentity(s3ImageSource("gold/a & b.jpg"))).toEqual({
      key: "gold/a & b.jpg",
    });
    expect(imageSourceIdentity("/api/reader/42/cover")).toEqual({
      calibreId: 42,
    });
    for (const source of [
      "https://example.com/a.jpg",
      "//example.com/a.jpg",
      "/api/s3/read",
      "/api/reader/1/file",
      "/api/reader/9007199254740993/cover",
      "data:image/svg+xml,test",
    ])
      expect(imageSourceIdentity(source)).toBeNull();
  });
  it("targets the same asset's full, thumbnail and optimized URLs without leaking to other images or previews", () => {
    const sources = [
      s3ImageSource("gold/full.jpg"),
      s3ImageSource("gold/thumb.jpg"),
      "/api/reader/42/cover",
    ];
    const css = imageAdjustmentStyles([
      {
        assetKey: "gold/full.jpg",
        sources,
        settings: DEFAULT_IMAGE_ADJUSTMENTS,
        monochrome: false,
      },
    ]);
    for (const source of sources) expect(css).toContain(`img[src="${source}"]`);
    expect(css).toContain("/_next/image?url=");
    expect(css).toContain(":not([data-adjustment-preview])");
    expect(css).toContain(
      `${imageAdjustmentFilter(DEFAULT_IMAGE_ADJUSTMENTS)} !important`,
    );
    expect(css).not.toContain("img {");
  });
  it("escapes hostile keys and skips invalid persisted settings", () => {
    const record = {
      assetKey: "</style>",
      sources: [s3ImageSource('</style>\"],body{color:red}/*')],
      settings: DEFAULT_IMAGE_ADJUSTMENTS,
      monochrome: false,
    };
    expect(imageAdjustmentStyles([record])).not.toContain("</style>");
    expect(
      imageAdjustmentStyles([
        {
          ...record,
          settings: { ...DEFAULT_IMAGE_ADJUSTMENTS, exposure: NaN },
        },
      ]),
    ).toBe("");
  });
});
