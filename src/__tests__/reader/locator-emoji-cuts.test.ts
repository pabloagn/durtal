// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ZodError } from "zod/v4";
import { QUOTE_CHARS, quoteAt, quoteFromSelection } from "@/lib/reader/engines/foliate/locator";
import { headOf, tailOf } from "@/lib/reader/engines/foliate/quote-match";
import { pdfLocatorFromGeometry } from "@/lib/reader/engines/foliate/pdf-geometry";
import { annotationLocatorSchema } from "@/lib/validations/annotations";
import { markFailureMessage } from "@/lib/reader/mark-failure";

// SLN-1494: the text before and after a mark, and the quote itself, were cut
// in UTF-16 units, so a cut inside an emoji left half a surrogate pair and the
// save was refused, its notice the validator's JSON.

const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const family = "👨‍👩‍👧";
const flag = "🇫🇷";
const hash = "c".repeat(64);

/** Text whose QUOTE_CHARS-th unit falls inside `mark`, from either end */
const padTo = (mark: string, units: number) => "x".repeat(units - 1) + mark;

describe("cutting quote text between characters", () => {
  it("never leaves half of an emoji, a ZWJ family or a flag", () => {
    for (const mark of ["🌙", family, flag]) {
      const text = padTo(mark, QUOTE_CHARS) + " and more";
      const head = headOf(text, QUOTE_CHARS);
      expect(head).toBe("x".repeat(QUOTE_CHARS - 1));
      expect(lone.test(head)).toBe(false);
      const reversed = mark + "x".repeat(QUOTE_CHARS - 1);
      const tail = tailOf("before " + reversed, QUOTE_CHARS);
      expect(tail).toBe("x".repeat(QUOTE_CHARS - 1));
      expect(lone.test(tail)).toBe(false);
    }
    expect(headOf("short", QUOTE_CHARS)).toBe("short");
    expect(tailOf("short", QUOTE_CHARS)).toBe("short");
    expect(headOf("a🌙b", 3)).toBe("a🌙");
  });

  it("gives a quote and context the stored locator accepts", () => {
    const text = `Moonlight note 🌙✨ with an emoji family ${family} and a flag ${flag} on the far side of the page, and more words after it.`;
    const whole = `${"Before the passage ".repeat(3)}${text}`;
    // Every place in the paragraph, so the 64th unit before and after falls
    // inside each of the emoji, the family and the flag in turn
    for (let at = 0; at + 3 <= whole.length; at++) {
      document.body.innerHTML = `<p>${whole}</p>`;
      const node = document.querySelector("p")!.firstChild!;
      const range = document.createRange();
      // A browser's selection never starts or ends inside a character
      const inside = (i: number) => /[\uDC00-\uDFFF]/.test(node.textContent![i] ?? "");
      if (inside(at) || inside(at + 3)) continue;
      range.setStart(node, at);
      range.setEnd(node, at + 3);
      for (const quote of [quoteAt(range)!, quoteFromSelection(range)!]) {
        for (const part of Object.values(quote)) expect(lone.test(part!)).toBe(false);
        const locator = { v: 1, fileHash: hash, href: "ch1.xhtml", sectionIndex: 0, progression: 0, totalProgression: 0, text: quote };
        expect(annotationLocatorSchema.safeParse(locator).success).toBe(true);
      }
    }
  });

  it("cuts a PDF passage's context the same way", () => {
    const locator = pdfLocatorFromGeometry({
      fileHash: hash,
      href: "file.pdf",
      pageIndex: 0,
      pageCount: 1,
      viewport: { height: 800, convertToViewportRectangle: (r: number[]) => r } as never,
      rects: [[10, 10, 100, 30]],
      text: { highlight: "The passage", before: flag + "x".repeat(31), after: "x".repeat(31) + family },
      tocLabel: "x".repeat(299) + flag,
    })!;
    expect(locator.text).toEqual({ highlight: "The passage", before: "x".repeat(31), after: "x".repeat(31) });
    expect(locator.tocLabel).toBe("x".repeat(299));
  });
});

describe("a refused mark's notice", () => {
  it("is a sentence, never the validator's JSON", () => {
    const refused = annotationLocatorSchema.safeParse({ v: 1, fileHash: hash, href: "a", sectionIndex: 0, progression: 0, totalProgression: 0, text: { after: "x\uD83C" } });
    expect(refused.error).toBeInstanceOf(ZodError);
    expect(markFailureMessage(refused.error)).toBe("This mark couldn't be saved.");
    const tooLong = annotationLocatorSchema.safeParse({ v: 1, fileHash: hash, href: "a".repeat(3000), sectionIndex: 0, progression: 0, totalProgression: 0 });
    expect(markFailureMessage(tooLong.error)).toBe("Select at most 2,048 characters");
    expect(markFailureMessage(new Error("This mark cannot be edited"))).toBe("This mark cannot be edited");
    expect(markFailureMessage("odd")).toBe("This mark couldn't be saved.");
  });
});
