// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { sanitizeNote } from "@/lib/reader/notes/sanitize";

function fragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}
function clean(html: string, options = {}) {
  const root = document.createElement("div");
  root.append(sanitizeNote(fragment(html), { document, ...options }));
  return root;
}

describe("note sanitization", () => {
  it("keeps literary and table markup while removing executable subtrees", () => {
    const result = clean(
      '<p class="note" style="color:red" onclick="evil()"><em>Note</em><script>bad</script><style>bad</style><iframe>bad</iframe><object>bad</object></p><embed><form>bad<input><button>bad</button></form><table><tbody><tr><th scope="col">A</th><td colspan="2">B</td></tr></tbody></table>',
    );
    expect(result.textContent).toBe("NoteAB");
    expect(result.querySelector("em")?.textContent).toBe("Note");
    expect(result.querySelector("td")?.getAttribute("colspan")).toBe("2");
    expect(result.querySelector("th")?.getAttribute("scope")).toBe("col");
    expect(
      result.querySelector(
        "[class], [style], [onclick], script, iframe, svg, form",
      ),
    ).toBeNull();
  });
  it("drops foreign-namespace SVG and its executable subtree", () => {
    const source = document.createDocumentFragment();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const script = document.createElementNS(svg.namespaceURI, "script");
    script.textContent = "evil()";
    svg.append(script);
    source.append(svg, document.createTextNode("kept"));
    expect(sanitizeNote(source, { document }).textContent).toBe("kept");
  });
  it("handles deeply nested passive wrappers without recursion", () => {
    const source = document.createDocumentFragment();
    let parent: Node = source;
    for (let i = 0; i < 2_000; i++) {
      const next = document.createElement("section");
      parent.appendChild(next);
      parent = next;
    }
    parent.appendChild(document.createTextNode("deep note"));
    expect(sanitizeNote(source, { document }).textContent).toBe("deep note");
  });
  it("does not mutate the pristine source and unwraps passive wrappers", () => {
    const source = fragment(
      '<section id="n1"><p class="note">kept</p></section>',
    );
    const before = source.cloneNode(true).textContent;
    const result = sanitizeNote(source, { document });
    expect(result.textContent).toBe(before);
    expect(source.querySelector("p")?.getAttribute("class")).toBe("note");
    expect(result.querySelector("section, [id], [class]")).toBeNull();
  });
  it("drops EPUB and ARIA backlinks but retains nested note references", () => {
    const result = clean(
      '<a epub:type="backlink" href="#ref">back1</a><a role="doc-backlink" href="#ref">back2</a><a epub:type="noteref" role="doc-noteref" href="notes.xhtml#n2">next</a>',
    );
    expect(result.textContent).toBe("next");
    expect(result.querySelector("a")?.getAttribute("epub:type")).toBe(
      "noteref",
    );
    expect(result.querySelector("a")?.getAttribute("role")).toBe("doc-noteref");
  });
  it("keeps approved external links isolated and strips unsafe hrefs", () => {
    const result = clean(
      '<a href="https://example.com" target="_self" ping="https://evil.test" onclick="evil()">safe</a><a href="javascript:evil()">unsafe</a>',
    );
    const [safe, unsafe] = result.querySelectorAll("a");
    expect(safe.getAttribute("target")).toBe("_blank");
    expect(safe.getAttribute("rel")).toBe("noopener noreferrer");
    expect(safe.hasAttribute("data-durtal-external")).toBe(true);
    expect(safe.hasAttribute("ping")).toBe(false);
    expect(unsafe.hasAttribute("href")).toBe(false);
  });
  it("validates resolved links again and never resolves already unsafe URLs", () => {
    const resolveLink = vi.fn(() => "javascript:evil()");
    const result = clean(
      '<a href="#note">A</a><a href="data:text/html,x">B</a>',
      { resolveLink },
    );
    expect(resolveLink).toHaveBeenCalledTimes(1);
    expect(result.querySelectorAll("a[href]")).toHaveLength(0);
  });
  it("requires an explicit resource lease and keeps useful image alternatives", () => {
    const noLease = clean(
      '<img src="https://evil.test/x" alt="plate" onerror="evil()" srcset="https://evil.test/y 2x">',
    );
    expect(noLease.querySelector("img")).toBeNull();
    expect(noLease.textContent).toBe("plate");
    const imageUrl = vi.fn(() => "blob:https://durtal.test/book-plate");
    const leased = clean(
      '<img src="plate.png" alt="plate" onload="evil()" srcset="x 2x">',
      { imageUrl },
    );
    expect(leased.querySelector("img")?.getAttribute("src")).toBe(
      "blob:https://durtal.test/book-plate",
    );
    expect(leased.querySelector("img")?.getAttributeNames()).toEqual([
      "src",
      "alt",
    ]);
    expect(imageUrl).toHaveBeenCalledWith("plate.png");
  });
  it.each(["https://evil.test/x", "data:image/svg+xml,x", "javascript:x"])(
    "rejects a resolver returning %s instead of a book blob",
    (url) => {
      expect(
        clean('<img src="plate.png" alt="plate">', {
          imageUrl: () => url,
        }).querySelector("img"),
      ).toBeNull();
    },
  );
  it("keeps language/direction and bounds table attributes", () => {
    const result = clean(
      '<p lang="la" dir="rtl" tabindex="0" contenteditable>vox</p><table><tr><td colspan="999999" rowspan="0" style="background:url(evil)">x</td></tr></table>',
    );
    expect(result.querySelector("p")?.getAttributeNames()).toEqual([
      "lang",
      "dir",
    ]);
    expect(result.querySelector("td")?.getAttributeNames()).toEqual([]);
  });
});
