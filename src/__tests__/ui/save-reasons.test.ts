// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSaveReason } from "@/components/shared/save-reason";
import { DialogFooter } from "@/components/reading/dialogs/fields";

/*
 * A dimmed Save says what it waits for beside it, and a screen reader reads
 * that with the button (SLN-1057): `useSaveReason` gives the line and the
 * button's `aria-describedby`.
 */

let root: Root | null = null;
let host: HTMLElement;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});
function render(element: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
}
const description = (button: Element) =>
  (button.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");

function Row({ name }: { name: string }) {
  const reason = useSaveReason(!name.trim() && "Give the person a name");
  return createElement("div", null, reason.hint, createElement("button", { disabled: !name.trim(), "aria-describedby": reason.describedBy }, "Save"));
}

describe("useSaveReason", () => {
  it("shows the reason beside a dimmed Save and ties it to the button", () => {
    render(createElement(Row, { name: " " }));
    const save = host.querySelector("button")!;
    expect(description(save)).toBe("Give the person a name");
    expect(host.textContent).toContain("Give the person a name");
  });

  it("says nothing, and describes nothing, once the field is filled", () => {
    render(createElement(Row, { name: "Jean Genet" }));
    expect(host.querySelector("button")!.hasAttribute("aria-describedby")).toBe(false);
    expect(host.querySelector("p")).toBeNull();
  });
});

describe("the reading dialogs' footer", () => {
  it("ties its hint to Save, as Log progress uses it", () => {
    render(createElement(DialogFooter, { form: "f", onCancel: () => {}, saving: false, saveLabel: "Log", disabled: true, hint: "Enter where you are" }));
    const log = [...host.querySelectorAll("button")].find((b) => b.textContent === "Log")!;
    expect(description(log)).toBe("Enter where you are");
  });
});

const read = (path: string) => readFileSync(`src/${path}`, "utf8");

describe("every dimmed Save in the list says why (SLN-1057)", () => {
  it.each([
    ["app/(catalogue)/library/[slug]/instance-add-dialog.tsx", "Choose a location"],
    ["app/(catalogue)/library/[slug]/instance-edit-dialog.tsx", "Choose a location"],
    ["app/(catalogue)/provenance/order-edit-dialog.tsx", "Give the order a date"],
    ["app/(catalogue)/places/[slug]/venue-institutions.tsx", "Choose an organization"],
    ["components/perfumes/bottle-dialog.tsx", "Choose a formulation"],
    ["components/paintings/art-object-dialog.tsx", "Choose the institution"],
    ["components/paintings/whereabouts-dialog.tsx", "Choose the place"],
    ["components/paintings/whereabouts-dialog.tsx", "Give the start date"],
    ["components/catalogue/wanted-section.tsx", "Choose the version"],
    ["components/catalogue/wanted-section.tsx", "Give the order date"],
    ["components/catalogue/work-relations.tsx", "Choose the work"],
    ["components/collections/add-books-dialog.tsx", "Tick the books to add"],
    ["components/reading/dialogs/log-progress-dialog.tsx", "Enter where you are"],
    ["components/reading/dialogs/session-dialog.tsx", "Give where the session ended"],
  ])("%s: %s", (file, line) => {
    expect(read(file)).toContain(line);
  });

  it("ties each reason to its action: every file that makes one passes describedBy on", () => {
    const files = execSync("grep -rl 'useSaveReason(' src --include=*.tsx", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((file) => !file.endsWith("save-reason.tsx"));
    expect(files.length).toBeGreaterThan(30);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const made = [...source.matchAll(/const (\w+) = useSaveReason\(/g)].map((m) => m[1]);
      for (const name of made) {
        expect(source, `${file}: ${name}`).toContain(`aria-describedby={${name}.describedBy}`);
        expect(source, `${file}: ${name}`).toContain(`${name}.hint`);
      }
    }
  });

  it("leaves no reason line untied", () => {
    const hand = execSync("grep -rln 'RequiredNameHint' src --include=*.tsx || true", { encoding: "utf8" }).trim();
    expect(hand).toBe("");
  });
});
