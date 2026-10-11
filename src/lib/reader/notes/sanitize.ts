import { classifyReaderLink } from "@/lib/reader/links/policy";

const HTML = "http://www.w3.org/1999/xhtml";
const EPUB = "http://www.idpf.org/2007/ops";
const KEEP = new Set(
  "a abbr b br cite code dd dfn div dl dt em i img li ol p q small span strong sub sup ul table caption colgroup col thead tbody tfoot tr th td".split(
    " ",
  ),
);
const DROP = new Set(
  "script style iframe object embed form input button textarea select option optgroup fieldset legend output datalist template noscript base link meta audio video canvas".split(
    " ",
  ),
);

export interface NoteSanitizeOptions {
  document: Document;
  /** Resolved href must still pass the same policy. No book-base URL injection. */
  resolveLink?: (href: string) => string | null;
  /** Caller acquires and releases this book resource lease; no network here. */
  imageUrl?: (src: string) => string | null;
}

function tokens(value: string | null): string[] {
  return value?.trim().split(/\s+/) ?? [];
}

/** Clone into fresh nodes. Never edit the pristine document or insert HTML. */
export function sanitizeNote(
  source: Node,
  options: NoteSanitizeOptions,
): DocumentFragment {
  const doc = options.document;
  const result = doc.createDocumentFragment();
  const tasks: { node: Node; parent: Node }[] = [
    { node: source, parent: result },
  ];
  const enqueue = (node: Node, parent: Node) => {
    const children = Array.from(node.childNodes);
    for (let i = children.length - 1; i >= 0; i--)
      tasks.push({ node: children[i], parent });
  };
  while (tasks.length) {
    const { node, parent } = tasks.pop()!;
    if (node.nodeType === 3 || node.nodeType === 4) {
      parent.appendChild(doc.createTextNode(node.nodeValue ?? ""));
      continue;
    }
    if (node.nodeType !== 1) {
      if (node.nodeType === 11) enqueue(node, parent);
      continue;
    }
    const el = node as Element;
    const name = el.localName.toLowerCase();
    const types = tokens(
      el.getAttributeNS(EPUB, "type") || el.getAttribute("epub:type"),
    );
    const roles = tokens(el.getAttribute("role"));
    if (types.includes("backlink") || roles.includes("doc-backlink")) continue;
    if (el.namespaceURI !== HTML || DROP.has(name)) continue;
    if (!KEEP.has(name)) {
      enqueue(el, parent);
      continue;
    }
    const clean = doc.createElement(name);
    const lang = el.getAttribute("lang");
    if (lang) clean.setAttribute("lang", lang);
    const dir = el.getAttribute("dir");
    if (dir === "ltr" || dir === "rtl" || dir === "auto")
      clean.setAttribute("dir", dir);
    if (name === "a") {
      const raw = el.getAttribute("href");
      if (raw && classifyReaderLink(raw).kind !== "blocked") {
        const resolved = options.resolveLink ? options.resolveLink(raw) : raw;
        const policy = resolved
          ? classifyReaderLink(resolved)
          : { kind: "blocked" as const };
        if (policy.kind !== "blocked") {
          clean.setAttribute("href", policy.href);
          if (policy.kind === "external") {
            clean.setAttribute("target", "_blank");
            clean.setAttribute("rel", "noopener noreferrer");
            clean.setAttribute("data-durtal-external", "");
          }
        }
      }
      // Only semantic note references survive, never arbitrary roles.
      const noteTypes = types.filter((type) =>
        ["noteref", "biblioref", "glossref"].includes(type),
      );
      const noteRoles = roles.filter((role) =>
        ["doc-noteref", "doc-biblioref", "doc-glossref"].includes(role),
      );
      if (noteTypes.length)
        clean.setAttributeNS(EPUB, "epub:type", noteTypes.join(" "));
      if (noteRoles.length) clean.setAttribute("role", noteRoles.join(" "));
    }
    if (name === "img") {
      const alt = el.getAttribute("alt") ?? "";
      const raw = el.getAttribute("src");
      const url = raw ? options.imageUrl?.(raw) : null;
      // Only a caller-issued book blob lease may cross into the app surface.
      if (
        !url ||
        !/^blob:https?:\/\//i.test(url) ||
        /[\u0000-\u001f\u007f]/u.test(url)
      ) {
        if (alt) parent.appendChild(doc.createTextNode(alt));
        continue;
      }
      clean.setAttribute("src", url);
      clean.setAttribute("alt", alt);
    }
    if (
      name === "th" ||
      name === "td" ||
      name === "col" ||
      name === "colgroup"
    ) {
      for (const attr of ["colspan", "rowspan", "span"]) {
        const value = el.getAttribute(attr);
        if (value && /^\d{1,3}$/.test(value) && Number(value) > 0)
          clean.setAttribute(attr, value);
      }
      const scope = el.getAttribute("scope");
      if (
        name === "th" &&
        scope &&
        ["row", "col", "rowgroup", "colgroup"].includes(scope)
      )
        clean.setAttribute("scope", scope);
    }
    parent.appendChild(clean);
    enqueue(el, clean);
  }
  return result;
}
