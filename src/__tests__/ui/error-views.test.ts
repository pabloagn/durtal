// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

import { DomainError } from "@/components/domains/domain-states";

// Error views (SLN-700): a record that fails names the record and leads back
// to its list; every error view sets the tab's title and offers a shared
// Button (44px on touch) and a way back.
function render(props: Parameters<typeof DomainError>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(DomainError, props));
  return host;
}
const error = Object.assign(new Error("boom"), { digest: "x" });
const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

describe("DomainError", () => {
  it("names one film and leads back to the films", () => {
    quiet();
    const host = render({ kind: "film", error, reset: () => {}, record: true });
    expect(host.textContent).toContain("This film could not be loaded.");
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/films");
    expect(host.querySelector("a")!.textContent).toBe("Back to films");
    expect(host.querySelector("title")!.textContent).toBe("Something went wrong | Durtal");
    expect(host.querySelector("button")!.className).toContain("pointer-coarse:min-h-11");
  });

  it("keeps the collection's wording for a list", () => {
    quiet();
    const host = render({ kind: "painting", error, reset: () => {} });
    expect(host.textContent).toContain("Paintings could not be loaded.");
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/");
  });
});

describe("error files", () => {
  const app = path.resolve(__dirname, "../../app/(catalogue)");
  it.each(["library", "films", "paintings", "perfumes"])("%s/[slug] has a record-level error view", (dir) => {
    const file = path.join(app, dir, "[slug]", "error.tsx");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(/<DomainError kind="\w+" record/);
  });
  it.each(["error.tsx", "harmonize/error.tsx"])("%s uses the shared error view", (file) => {
    expect(readFileSync(path.join(app, file), "utf8")).toContain("<SectionError");
  });
});
