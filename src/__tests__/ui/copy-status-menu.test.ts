import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1124: a copy's status menu was a hand-made popover that Escape did not
// close, dropped the focus on the page after a change, and deaccessioned a
// copy on one click with no disposition. The browser behaviour was checked
// in Chromium, Firefox and WebKit; this pins it.
const source = readFileSync(
  path.resolve(__dirname, "../../app/(catalogue)/library/[slug]/instance-status-button.tsx"),
  "utf8",
);

describe("a copy's status menu", () => {
  it("is the app's menu, a radio item per status", () => {
    expect(source).toContain("<DropdownMenu");
    expect(source).toContain("checked={s === status}");
    expect(source).not.toContain('addEventListener("mousedown"');
  });

  it("is busy, not disabled, while it saves, and guards in the handler", () => {
    expect(source).toContain("aria-busy={busy || undefined}");
    expect(source).toContain("if (busy) return;");
    expect(source).not.toMatch(/disabled=\{isPending\}/);
  });

  it("asks who has a lent copy and since when, and offers its return (SLN-1125)", () => {
    expect(source).toContain('<DropdownMenuItem onClick={() => applyStatus("available")}>Mark as returned</DropdownMenuItem>');
    expect(source).toContain('title="Lend this copy"');
    expect(source).toContain('setLend({ to: "", date: todayLocal() });');
    expect(source).toContain('applyStatus("lent_out", { lentTo: lend.to.trim() || null, lentDate: lend.date })');
  });

  it("deaccessions only on a confirm that records the disposition", () => {
    expect(source).toContain('title="Deaccession this copy"');
    expect(source).toContain('setDisposition({ type: "", date: todayLocal(), to: "" });');
    expect(source).toContain("dispositionDate: disposition.date,");
    // Danger: Enter in a field never presses it
    expect(source).toMatch(/variant="danger"[\s\S]*?disabled=\{!disposition\.date\}/);
    expect(source).toMatch(/next === "deaccessioned"\) \{\s*setDisposition[^\n]*\n\s*setAsking\("deaccessioned"\);/);
  });
});
