// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditionImageBox } from "@/components/books/edition-cover";
import { AmbientCrystals, PosterGlow } from "@/app/library/[slug]/ambient-crystals";
import { coarseImageFallback } from "@/components/shared/coarse-image-source";
import { imageSourceIdentity, imageAdjustmentRule, DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustment-css";
import type { CrystalColor } from "@/lib/types";

function markup(element: Parameters<typeof renderToStaticMarkup>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}
const source = "/api/s3/read?key=gold%2Fmedia%2Fposter.webp";
const palette: CrystalColor[] = [
  { hex: "#426270", rgb: [66, 98, 112], opacity: .3, role: "primary" },
  { hex: "#695e72", rgb: [105, 94, 114], opacity: .25, role: "secondary" },
  { hex: "#716548", rgb: [113, 101, 72], opacity: .2, role: "accent" },
  { hex: "#355166", rgb: [53, 81, 102], opacity: .15, role: "halo" },
];

describe("ordinary book detail resource bounds", () => {
  it.each(["md", "sm"] as const)("bounds original-poster thumbnail fallback at %s without changing crop or saved adjustments", (size) => {
    const crop = { x: 25, y: 65, zoom: 110, brightness: 90, contrast: 105 };
    const host = markup(createElement(EditionImageBox, {
      image: { key: "gold/media/poster.webp", crop, source: "poster" }, title: "Fixture", size,
    }));
    const img = host.querySelector("img")!;
    const url = new URL(img.getAttribute("src")!, "https://fixture.invalid");
    expect(url.searchParams.get("w")).toBe("240");
    expect(imageSourceIdentity(url.pathname + url.search)).toEqual(imageSourceIdentity(source));
    expect(img.style.objectPosition).toBe("25% 65%");
    expect(img.style.transform).toBe("scale(1.1)");
    expect(img.style.filter).toBe("brightness(90%) contrast(105%)");
    expect(img.getAttribute("loading")).toBe("lazy");
    const rule = imageAdjustmentRule({ assetKey: "gold/media/poster.webp", sources: [source], settings: DEFAULT_IMAGE_ADJUSTMENTS, monochrome: false });
    expect(rule).toContain('img[src^="' + source + '&"]');
  });

  it("bounds own edition cover fallbacks and retains the absent-cover placeholder", () => {
    const own = markup(createElement(EditionImageBox, { image: { key: "gold/covers/full.webp", source: "edition", crop: null }, title: "Fixture" }));
    expect(new URL(own.querySelector("img")!.getAttribute("src")!, "https://fixture.invalid").searchParams.get("w")).toBe("240");
    const absent = markup(createElement(EditionImageBox, { image: null, title: "Fixture" }));
    expect(absent.querySelector("img")).toBeNull();
    expect(absent.textContent).toContain("No cover");
  });

  it("bounds only owned fallback URLs and preserves version and asset identity", () => {
    const versioned = source + "&v=123";
    expect(coarseImageFallback(versioned)).toBe(versioned + "&w=800");
    expect(imageSourceIdentity(coarseImageFallback(versioned))).toEqual(imageSourceIdentity(versioned));
    expect(coarseImageFallback("https://images.example/art.jpg")).toBe("https://images.example/art.jpg");
    expect(coarseImageFallback("")).toBe("");
  });

  it("retains the atmosphere and desktop filters while limiting coarse decoration to one unfiltered plane", () => {
    const host = markup(createElement(AmbientCrystals, { palette }));
    const coarse = host.querySelector(".book-ambient-coarse") as HTMLElement;
    expect(coarse).not.toBeNull();
    // Happy DOM's shorthand parser mistakes rgb(... / alpha) for a
    // background-position/size separator. Check all emitted layers here;
    // native computed background-image remains a separate browser check.
    expect(((coarse.getAttribute("style") ?? "").match(/radial-gradient/g) ?? []).length).toBe(4);
    expect(coarse.style.filter).toBe("");
    expect(coarse.style.transform).toBe("");
    expect(coarse.children.length).toBe(0);
    const desktop = host.querySelector(".book-ambient-desktop") as HTMLElement;
    expect(desktop.style.transform).toBe("scale(1.3)");
    expect(desktop.children.length).toBeGreaterThanOrEqual(8);
    expect([...desktop.children].every(child => (child as HTMLElement).style.filter.includes("blur("))).toBe(true);
    expect(host.firstElementChild!.getAttribute("style")).toContain("mask-composite:intersect");
    const glow = markup(createElement(PosterGlow, { palette }));
    const coarseGlow = glow.querySelector(".book-ambient-coarse") as HTMLElement;
    expect(((coarseGlow.getAttribute("style") ?? "").match(/radial-gradient/g) ?? []).length).toBe(2);
    expect(coarseGlow.style.filter).toBe("");
    expect(glow.querySelectorAll(".book-ambient-desktop")).toHaveLength(2);
    expect(markup(createElement(AmbientCrystals, { palette: [] })).children).toHaveLength(0);
    expect(markup(createElement(PosterGlow, { palette: [] })).children).toHaveLength(0);
  });
});
