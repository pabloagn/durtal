// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { readFileSync } from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { Monogram } from "@/components/shared/no-photo";

// A person with no portrait, or a failed one, shows the initials and tint of
// their card, not the name's first character (SLN-1007)
function initials(name: string) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(Monogram, { name }));
  return host.textContent;
}

describe("person header without a portrait", () => {
  it("skips punctuation and capitalises a lowercase particle", () => {
    expect(initials("'Abd al-Rahman")).toBe("AR");
    expect(initials("de Sade")).toBe("DS");
    expect(initials("Huysmans")).toBe("H");
  });

  it("uses the card's Monogram for both a missing and a failed portrait", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(catalogue)/people/[slug]/author-detail-header.tsx"),
      "utf8",
    );
    expect(source).not.toContain("{name[0]}");
    // One fallback serves both: the portrait shows only while it has not failed
    expect(source).toContain("posterUrl && posterUrl !== failedPortrait ?");
    expect(source.match(/<Monogram name=\{name\} \/>/g)).toHaveLength(1);
  });
});
