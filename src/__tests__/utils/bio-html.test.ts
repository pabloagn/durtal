import { describe, expect, it } from "vitest";
import { cleanBioForStorage, sanitizeDescriptionHtml } from "@/lib/utils/sanitize";
import { escapeHtml, plainTextToHtml, isSafeLinkUrl } from "@/lib/utils/html-text";

// Author bios are sanitized like book descriptions (SLN-277, SLN-397)
describe("sanitizeDescriptionHtml on author bios", () => {
  it("removes scripts, event handlers and dangerous elements", () => {
    const out = sanitizeDescriptionHtml(
      '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)"><iframe src="https://evil"></iframe><style>p{}</style>',
    );
    expect(out).toBe("<p>ok</p>");
  });

  it("removes on* attributes from allowed tags", () => {
    expect(sanitizeDescriptionHtml('<p onclick="alert(1)">x</p>')).toBe("<p>x</p>");
    expect(sanitizeDescriptionHtml('<a href="https://x.y" onmouseover="alert(1)">l</a>')).toBe(
      '<a href="https://x.y">l</a>',
    );
  });

  it("drops javascript:, data: and mailto: links but keeps the text", () => {
    expect(sanitizeDescriptionHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeDescriptionHtml('<a href="data:text/html,<script>">x</a>')).not.toContain("data:");
    expect(sanitizeDescriptionHtml('<a href="mailto:a@b.c">x</a>')).toBe("<a>x</a>");
  });

  it("keeps the formatting the bio editor and the stored bios use", () => {
    // sanitize-html writes void elements as <br />
    const html =
      '<p><b>Bold</b> <i>it</i> <strong>s</strong> <em>e</em><br />next</p><ul><li>a</li></ul><ol><li>b</li></ol><p><a href="https://example.com">site</a></p>';
    expect(sanitizeDescriptionHtml(html)).toBe(html);
  });

  it("drops style and class attributes", () => {
    expect(sanitizeDescriptionHtml('<p style="color:red" class="x">t</p>')).toBe("<p>t</p>");
  });

  it("keeps escaped text escaped", () => {
    expect(sanitizeDescriptionHtml("<p>&lt;img src=x onerror=alert(1)&gt;</p>")).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;</p>",
    );
  });

  it("is idempotent", () => {
    const once = sanitizeDescriptionHtml('<p>a <a href="https://x.y">l</a></p><script>z</script>');
    expect(sanitizeDescriptionHtml(once)).toBe(once);
  });
});

describe("cleanBioForStorage", () => {
  it("passes undefined through (field not sent)", () => {
    expect(cleanBioForStorage(undefined)).toBeUndefined();
  });

  it("stores null for null, empty or invisible bios", () => {
    expect(cleanBioForStorage(null)).toBeNull();
    expect(cleanBioForStorage("")).toBeNull();
    expect(cleanBioForStorage("<p><br></p>")).toBeNull();
    expect(cleanBioForStorage("<p>&nbsp;</p>")).toBeNull();
    expect(cleanBioForStorage("<script>alert(1)</script>")).toBeNull();
  });

  it("stores sanitized HTML otherwise", () => {
    expect(cleanBioForStorage('<p onclick="x">Hi</p>')).toBe("<p>Hi</p>");
    expect(cleanBioForStorage('<p>Hi</p><img src=x onerror="alert(1)">')).toBe("<p>Hi</p>");
  });

  it("keeps a bio as the enrichment writes it", () => {
    const bio = "<p>French novelist.</p><p>Known for <em>Là-bas</em> and <em>À rebours</em>.</p>";
    expect(cleanBioForStorage(bio)).toBe(bio);
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("plainTextToHtml", () => {
  it("keeps pasted markup as literal text", () => {
    expect(plainTextToHtml("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("stays literal text after the server sanitizes it", () => {
    const pasted = plainTextToHtml('<img src=x onerror="alert(1)">');
    expect(cleanBioForStorage(pasted)).toBe("<p>&lt;img src=x onerror=\"alert(1)\"&gt;</p>");
  });

  it("keeps comparison and ampersand text intact", () => {
    expect(plainTextToHtml("A < B & C")).toBe("<p>A &lt; B &amp; C</p>");
  });

  it("turns blank lines into paragraphs and newlines into <br>", () => {
    expect(plainTextToHtml("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });

  it("normalizes Windows line endings and skips empty paragraphs", () => {
    expect(plainTextToHtml("a\r\n\r\n\r\nb\r\n\r\n")).toBe("<p>a</p><p>b</p>");
    expect(plainTextToHtml("")).toBe("");
  });
});

describe("isSafeLinkUrl", () => {
  it("accepts web links", () => {
    expect(isSafeLinkUrl("https://example.com")).toBe(true);
    expect(isSafeLinkUrl("http://example.com/a?b=c")).toBe(true);
    expect(isSafeLinkUrl("  https://example.com  ")).toBe(true);
  });

  it("rejects script, data, mail and malformed URLs", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl(" JavaScript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,x")).toBe(false);
    expect(isSafeLinkUrl("mailto:a@b.c")).toBe(false);
    expect(isSafeLinkUrl("not a url")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
  });
});
