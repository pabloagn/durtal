import { sanitizeNote } from "../notes/sanitize";

export interface ReaderMedia {
  kind: "image" | "table";
  element: Element;
  caption: string;
  reference: HTMLElement;
}
export function viewerImage(target: EventTarget | null): Element | null {
  const el = target as Element | null;
  if (!el?.closest || el.closest("a[href], [data-reader-chrome]")) return null;
  const image = el.closest("img, svg");
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  return rect.width >= 64 && rect.height >= 64 ? image : null;
}

/** SVG stays an image. No scripts, event attributes, foreignObject, external resources or navigation. */
export function sanitizedSvg(source: Element): Element {
  const svg = source.cloneNode(true) as Element;
  for (const el of [svg, ...svg.querySelectorAll("*")]) {
    if (
      [
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "style",
        "a",
        "animate",
        "set",
        "animateMotion",
        "animateTransform",
      ].includes(el.localName)
    ) {
      el.remove();
      continue;
    }
    for (const attribute of [...el.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "src" ||
        name === "xml:base" ||
        name === "base" ||
        ((name === "href" || name === "xlink:href") &&
          !/^#[\w.-]+$/.test(value)) ||
        (/url\s*\(/i.test(value) &&
          !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/.test(value))
      )
        el.removeAttribute(attribute.name);
    }
  }
  return svg;
}

/** No resource acquisition or HTML insertion; the caller holds the image resource leases. */
export function tableForViewer(source: Element, doc: Document) {
  const fragment = sanitizeNote(source, {
    document: doc,
    imageUrl: (url) => (/^blob:https?:\/\//.test(url) ? url : null),
  });
  const table = fragment.querySelector("table")!;
  // Classes select publisher table rules; they cannot carry URLs or executable attributes.
  const original = [source, ...source.querySelectorAll("*")];
  const copied = [table, ...table.querySelectorAll("*")];
  if (original.length === copied.length)
    original.forEach((el, index) => {
      const names = [...el.classList].filter((name) =>
        /^[\w-]{1,100}$/.test(name),
      );
      if (names.length) copied[index].setAttribute("class", names.join(" "));
    });
  return table;
}

export function cleanedTableStyles(doc: Document): string {
  const rules: string[] = [];
  for (const sheet of [...doc.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules]) {
        // Resource-bearing and global at-rules do not belong in the isolated viewer.
        if (
          rule.cssText.startsWith("@") ||
          /url\s*\(|expression\s*\(|-moz-binding|javascript:/i.test(
            rule.cssText,
          )
        )
          continue;
        rules.push(rule.cssText);
      }
    } catch {
      /* An inaccessible sheet cannot supply safe local rules. */
    }
  }
  return rules.join("\n");
}
