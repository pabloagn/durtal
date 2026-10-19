import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// SLN-1120: a book's acquisition targets offered "Any edition" when it
// existed, showed raw state words and ISO dates, named every Remove alike
// with no undo, used blue links, and dropped the focus after Add target. The
// browser behaviour was checked in Chromium, Firefox and WebKit; this pins it.
const source = readFileSync(path.resolve(__dirname, "../../components/publishers/acquisition-targets.tsx"), "utf8");

describe("a book's acquisition targets", () => {
  it("offers only the choices that can succeed", () => {
    expect(source).toContain('...(hasAny ? [] : [{ value: "any", label: "Any edition" }])');
    expect(source).toContain("...(freeEditions.length ? [{ value: \"edition\", label: \"Exact edition\" }] : [])");
    expect(source).toContain("...freeEditions.map((e) => ({");
  });

  it("shows the app's state and order words, and dates in its form", () => {
    expect(source).toContain("{TARGET_STATE_LABELS[state]}");
    expect(source).toContain("{formatDate(o.date)} · {orderStatusLabel(o.status)}");
    expect(source).not.toContain('state.replace("_", " ")');
  });

  it("names each Remove after its target and offers Undo", () => {
    expect(source).toContain("aria-label={`Remove target: ${targetName(t)}`}");
    expect(source).toMatch(/action: \{ label: "Undo", onClick: \(\) => void undo\(t\) \}/);
    expect(source).toContain("await restoreAcquisitionTarget(t.target.id);");
  });

  it("says whether the add form is open, and links in the interaction colour", () => {
    expect(source).toContain("aria-expanded={open}");
    expect(source).not.toContain("text-accent-blue");
  });

  it("focuses the new target once it shows", () => {
    expect(source).toContain("added.current = row.id;");
    expect(source).toContain("[data-target-id=\"${added.current}\"]");
  });
});
