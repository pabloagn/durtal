import { describe, expect, it } from "vitest";
import { sanitizeBioHtml, cleanBioForStorage } from "@/lib/utils/sanitize";
import { escapeHtml, plainTextToHtml, isSafeLinkUrl } from "@/lib/utils/html-text";

describe("sanitizeBioHtml", () => {
  it("removes scripts, event handlers and dangerous elements", () => {
    const out = sanitizeBioHtml(
      '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)"><iframe src="https://evil"></iframe><style>p{}</style>',
    );
    expect(out).toBe("<p>ok</p>");
  });

  it("removes on* attributes from allowed tags", () => {
    expect(sanitizeBioHtml('<p onclick="alert(1)">x</p>')).toBe("<p>x</p>");
  });

  it("drops javascript: and data: links but keeps the text", () => {
    expect(sanitizeBioHtml('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript");
    expect(sanitizeBioHtml('<a href="data:text/html,<script>">x</a>')).not.toContain("data:");
    expect(sanitizeBioHtml('<a href="//evil.example">x</a>')).not.toContain("evil");
  });

  it("keeps editor formatting", () => {
    // sanitize-html writes void elements as <br />
    const html = "<p><b>Bold</b> <i>it</i> <u>u</u> <strong>s</strong> <em>e</em></p><ul><li>a</li></ul><ol><li>b</li></ol><div>d<br />e</div><blockquote>q</blockquote>";
    expect(sanitizeBioHtml(html)).toBe(html);
  });

  it("keeps safe links and forces a new tab without opener access", () => {
    const out = sanitizeBioHtml('<a href="https://example.com" target="_self" rel="opener">site</a>');
    expect(out).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a>');
    expect(sanitizeBioHtml('<a href="mailto:a@b.c">mail</a>')).toContain('href="mailto:a@b.c"');
  });

  it("drops style and class attributes", () => {
    expect(sanitizeBioHtml('<p style="color:red" class="x">t</p>')).toBe("<p>t</p>");
  });

  it("keeps escaped text escaped", () => {
    expect(sanitizeBioHtml("<p>&lt;img src=x onerror=alert(1)&gt;</p>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });

  it("is idempotent", () => {
    const once = sanitizeBioHtml('<p>a <a href="https://x.y">l</a></p><script>z</script>');
    expect(sanitizeBioHtml(once)).toBe(once);
  });
});

describe("cleanBioForStorage", () => {
  it("passes undefined through (field not provided)", () => {
    expect(cleanBioForStorage(undefined)).toBeUndefined();
  });

  it("stores null for null, empty or invisible bios", () => {
    expect(cleanBioForStorage(null)).toBeNull();
    expect(cleanBioForStorage("")).toBeNull();
    expect(cleanBioForStorage("<p><br></p>")).toBeNull();
    expect(cleanBioForStorage("<script>alert(1)</script>")).toBeNull();
  });

  it("stores sanitized HTML otherwise", () => {
    expect(cleanBioForStorage('<p onclick="x">Hi</p>')).toBe("<p>Hi</p>");
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
  it("accepts web and mail links", () => {
    expect(isSafeLinkUrl("https://example.com")).toBe(true);
    expect(isSafeLinkUrl("http://example.com/a?b=c")).toBe(true);
    expect(isSafeLinkUrl("mailto:a@b.c")).toBe(true);
  });

  it("rejects script, data and malformed URLs", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl(" JavaScript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("data:text/html,x")).toBe(false);
    expect(isSafeLinkUrl("not a url")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
  });
});
