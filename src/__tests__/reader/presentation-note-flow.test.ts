// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { presentationCss, presentationFromPreferences, policyTypographyCss } from "@/lib/reader/presentation";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";

const presentation = presentationFromPreferences(PRESENTATION_DEFAULTS.desktop, "http://localhost:3410");
afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });

for (const [name, css] of [
  ["current", policyTypographyCss(presentation)],
  ["legacy", presentationCss({ ...presentation, policy: undefined })],
]) {
  it.each(["footnote", "endnote", "note", "rearnote"])(`${name}: hides an HTML %s without hiding its popup content`, (kind) => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.body.innerHTML = `<p>Chapter text</p><aside epub:type="${kind}"><p>A note</p></aside>`;
    const note = document.querySelector("aside")!;
    // HTML parsing retains a plain colon attribute, as the srcdoc renderer does.
    expect(note.getAttributeNS("http://www.idpf.org/2007/ops", "type")).toBeNull();
    expect(getComputedStyle(note).display).toBe("none");
    expect(getComputedStyle(document.querySelector("p")!).display).not.toBe("none");
    const popup = document.createElement("div");
    popup.append(note.firstElementChild!.cloneNode(true));
    document.body.append(popup);
    expect(getComputedStyle(popup.firstElementChild!).display).not.toBe("none");
  });
}
