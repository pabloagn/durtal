// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const audit = readFileSync(
  "scripts/qa/image-adjustment-frame-audit.js",
  "utf8",
);
afterEach(() => {
  document.body.replaceChildren();
});

function measuredFrame(
  kind: "poster" | "background",
  width: number,
  height: number,
  wellWidth: number,
  wellHeight: number,
) {
  const well = document.createElement("div");
  well.className =
    "image-editor-preview" +
    (kind === "background" ? " image-editor-preview-landscape" : "");
  const frame = document.createElement("div");
  frame.className = "image-editor-frame";
  frame.setAttribute("data-image-crop-frame", "");
  frame.style.aspectRatio = kind === "background" ? "16 / 9" : "2 / 3";
  // Independent measured-geometry fixtures; the browser audit will obtain
  // these rectangles from native layout, not this DOM stub.
  frame.getBoundingClientRect = () => DOMRect.fromRect({ width, height });
  well.getBoundingClientRect = () =>
    DOMRect.fromRect({ width: wellWidth, height: wellHeight });
  well.append(frame);
  document.body.append(well);
}
function run() {
  return eval(audit) as {
    checked: { shape: string; deviation: number }[];
    issues: { problem: string }[];
  };
}

describe("image preview frame sizing regression", () => {
  it("accepts independent portrait and landscape dimensions at constrained and wide sizes", () => {
    measuredFrame("poster", 192, 288, 320, 382);
    measuredFrame("poster", 144, 216, 280, 220);
    measuredFrame("background", 320, 180, 320, 240);
    measuredFrame("background", 416, 234, 512, 240);
    const result = run();
    expect(result.checked).toHaveLength(4);
    expect(result.issues).toEqual([]);
  });

  it("rejects the old width-clamped landscape with a retained 240px height", () => {
    measuredFrame("background", 320, 240, 320, 240);
    expect(run().issues).toEqual([
      expect.objectContaining({
        problem: "Frame does not preserve the saved crop aspect",
      }),
    ]);
  });

  it("rejects a correctly proportioned frame that the well nevertheless clips", () => {
    measuredFrame("background", 512, 288, 512, 240);
    expect(run().issues).toEqual([
      expect.objectContaining({ problem: "Preview well clips the crop frame" }),
    ]);
  });

  it("does not treat a CSS-declared ratio or an empty run as successful measurement", () => {
    measuredFrame("poster", 208, 382, 208, 382);
    expect(run().issues).toHaveLength(1);
    document.body.replaceChildren();
    expect(run().issues).toEqual([
      { problem: "No framed adjustment preview was measured" },
    ]);
  });
});
