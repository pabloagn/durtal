/**
 * Run in an open poster/background adjustment editor, after layout settles.
 * Measures native frame rectangles against the independent media contract:
 * portrait 2:3 and background 16:9. It does not derive the expected ratio
 * from the CSS aspect-ratio property. A zero-frame run fails rather than
 * silently proving nothing. Use on synthetic product fixtures at narrow,
 * wide and expanded host widths in each browser engine.
 */
(() => {
  const checked = [];
  const issues = [];
  for (const frame of document.querySelectorAll(".image-editor-frame")) {
    // Contained assets have no fixed crop frame to compare to saved output.
    if (!frame.style.aspectRatio) continue;
    const well = frame.closest(".image-editor-preview");
    const shape = well.classList.contains("image-editor-preview-landscape")
      ? "background"
      : "poster";
    const expected = shape === "background" ? 16 / 9 : 2 / 3;
    const { width, height } = frame.getBoundingClientRect();
    const bounds = well.getBoundingClientRect();
    const deviation = Math.abs(width - height * expected);
    const result = { shape, width, height, expected, deviation };
    checked.push(result);
    if (!width || !height || deviation > 0.5)
      issues.push({ ...result, problem: "Frame does not preserve the saved crop aspect" });
    if (width > bounds.width + 0.5 || height > bounds.height + 0.5)
      issues.push({ ...result, problem: "Preview well clips the crop frame" });
  }
  if (!checked.length) issues.push({ problem: "No framed adjustment preview was measured" });
  return { checked, issues };
})();
