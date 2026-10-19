// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { zoomRetired } from "@/vendor/foliate-js/fixed-layout.js";

const frame = (connected: boolean) => {
  const iframe = document.createElement("iframe");
  if (connected) document.body.append(iframe);
  return { iframe };
};

describe("a PDF page's zoom paint after the page was let go of (SLN-1169)", () => {
  it("takes the cancellation of a page no longer shown as expected", () => {
    expect(zoomRetired(frame(false), new DOMException("signal is aborted without reason", "AbortError"))).toBe(true);
    expect(zoomRetired(frame(false), new DOMException("PDF frame was retired", "AbortError"))).toBe(true);
    expect(zoomRetired(undefined, new DOMException("aborted", "AbortError"))).toBe(true);
  });
  it("lets a real failure, or the cancellation of a page still shown, go on", () => {
    expect(zoomRetired(frame(false), new Error("current PDF render failed"))).toBe(false);
    expect(zoomRetired(frame(true), new DOMException("session retired", "AbortError"))).toBe(false);
  });
});
