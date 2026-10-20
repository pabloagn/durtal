import { Parser } from "htmlparser2";
import { invalidUnicode } from "./fields";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const link = (href: unknown) => typeof href === "string" && /^(https?:\/\/|\/[^/]|#)/i.test(href) && !/[\u0000-\u0020\u007f]/.test(href);
const tags: Record<string, string> = { paragraph: "p", blockquote: "blockquote", bulletList: "ul", orderedList: "ol", listItem: "li", codeBlock: "pre", horizontalRule: "hr", hardBreak: "br" };
const marks: Record<string, string> = { bold: "strong", italic: "em", strike: "s", underline: "u", code: "code", link: "a" };

/** Small server renderer for the editor's supported document, bounded before recursion. */
export function renderThought(value: unknown): string {
  const pending: unknown[] = [value];
  let inspected = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++inspected > 100000) throw new Error("Thought is too complex");
    if (typeof item === "string" && invalidUnicode(item)) throw new Error("Thought contains a character PostgreSQL cannot store");
    if (item && typeof item === "object") for (const [key, child] of Object.entries(item)) {
      if (invalidUnicode(key)) throw new Error("Thought contains a character PostgreSQL cannot store");
      pending.push(child);
    }
  }
  if (!object(value) || value.type !== "doc") throw new Error("A thought must be a document");
  let nodes = 0, chars = 0;
  function render(node: unknown, depth: number, parent: string): string {
    if (++nodes > 10000 || depth > 32 || !object(node) || typeof node.type !== "string") throw new Error("Invalid or oversized thought document");
    const type = node.type;
    if (Object.keys(node).some((key) => !["type", "attrs", "content", "text", "marks"].includes(key))) throw new Error("Unsupported thought document field");
    if (type === "text") {
      if (!["paragraph", "codeBlock"].includes(parent) || typeof node.text !== "string" || node.content !== undefined || node.attrs !== undefined) throw new Error("Invalid thought text");
      if (invalidUnicode(node.text)) throw new Error("Invalid thought text");
      chars += node.text.length;
      if (chars > 200000) throw new Error("Thought is too long");
      let html = escape(node.text);
      if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.length > 6)) throw new Error("Invalid thought formatting");
      const seen = new Set<string>();
      for (const mark of (node.marks ?? []) as unknown[]) {
        if (!object(mark) || typeof mark.type !== "string" || !Object.hasOwn(marks, mark.type) || seen.has(mark.type) || Object.keys(mark).some((k) => k !== "type" && k !== "attrs")) throw new Error("Unsupported thought formatting");
        seen.add(mark.type);
        const attrs = mark.attrs ?? {};
        if (!object(attrs)) throw new Error("Invalid thought attributes");
        if (mark.type === "link") {
          if (!link(attrs.href) || Object.keys(attrs).some((k) => !["href", "target", "rel", "class"].includes(k))) throw new Error("Unsupported thought link");
          if (Object.entries(attrs).some(([key, val]) => key !== "href" && val != null && (typeof val !== "string" || val.length > 200))) throw new Error("Invalid link attribute");
          if (attrs.target != null && !["_blank","_self"].includes(String(attrs.target))) throw new Error("Unsupported link target");
          if (attrs.class != null && attrs.class !== "") throw new Error("Unsupported link class");
          html = `<a href="${escape(attrs.href as string)}" target="_blank" rel="noopener noreferrer nofollow">${html}</a>`;
        } else {
          if (Object.keys(attrs).length) throw new Error("Unsupported thought attributes");
          html = `<${marks[mark.type]}>${html}</${marks[mark.type]}>`;
        }
      }
      if (parent === "codeBlock" && seen.size) throw new Error("Code blocks cannot contain marked text");
      return html;
    }
    if (node.text !== undefined || node.marks !== undefined) throw new Error("Invalid thought node");
    const attrs = node.attrs ?? {};
    if (!object(attrs)) throw new Error("Invalid thought attributes");
    if (type === "doc" ? parent !== "" : !Object.hasOwn(tags, type)) throw new Error("Unsupported thought node");
    if (type === "orderedList") {
      if (Object.keys(attrs).some((k) => k !== "start" && k !== "type") || (attrs.start != null && (!Number.isInteger(attrs.start) || Number(attrs.start) < 1 || Number(attrs.start) > 100000))) throw new Error("Invalid list start");
      if (attrs.type != null) throw new Error("Unsupported list style");
    } else if (type === "codeBlock") {
      if (Object.keys(attrs).some((k) => k !== "language") || (attrs.language != null && (typeof attrs.language !== "string" || !/^[\w+-]{1,40}$/.test(attrs.language)))) throw new Error("Unsupported code language");
    } else if (Object.keys(attrs).length) throw new Error("Unsupported thought attributes");
    const children = node.content ?? [];
    if (!Array.isArray(children)) throw new Error("Invalid thought content");
    const block = ["paragraph", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule"];
    for (const child of children) {
      const childType = object(child) ? child.type : null;
      const allowed = type === "paragraph" ? ["text", "hardBreak"] : type === "codeBlock" ? ["text"] : type === "bulletList" || type === "orderedList" ? ["listItem"] : block;
      if (!allowed.includes(childType as string)) throw new Error("Invalid thought nesting");
    }
    if ((type === "hardBreak" || type === "horizontalRule") && children.length) throw new Error("Invalid empty node");
    if (type === "listItem" && (!children.length || (children[0] as { type?: string }).type !== "paragraph")) throw new Error("A list item needs a paragraph");
    const content = children.map((child) => render(child, depth + 1, type)).join("");
    if (type === "doc") return content;
    if (type === "hardBreak" || type === "horizontalRule") return `<${tags[type]}>`;
    if (type === "orderedList") return `<ol${attrs.start && attrs.start !== 1 ? ` start="${attrs.start}"` : ""}>${content}</ol>`;
    if (type === "codeBlock") return `<pre><code${attrs.language ? ` class="language-${attrs.language}"` : ""}>${content}</code></pre>`;
    return `<${tags[type]}>${content}</${tags[type]}>`;
  }
  return render(value, 0, "");
}

/** Compare supported structure and formatting, independently of mark nesting or HTML attribute order. */
function canonical(html: string): string {
  const stack: { tag: string; mark?: string }[] = [], tokens: unknown[] = [];
  let nodes = 0;
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (++nodes > 10000 || stack.length > 32) throw new Error("Thought is too complex");
      if (!["p", "blockquote", "ul", "ol", "li", "pre", "code", "hr", "br", "strong", "em", "u", "s", "a"].includes(tag)) throw new Error(`Unsupported thought element: ${tag}`);
      const pre = stack.some((s) => s.tag === "pre");
      if ((tag === "pre" || (tag === "code" && !pre)) && attrs.class) throw new Error("Unsupported thought class");
      const parent = stack.at(-1)?.tag;
      if ((["strong","em","u","s","a","br"].includes(tag) || (tag === "code" && !pre)) && !stack.some((s) => s.tag === "p")) throw new Error("Invalid inline thought structure");
      if (tag === "li" && parent !== "ul" && parent !== "ol") throw new Error("Invalid thought list");
      if (tag === "ol" && attrs.start && (!/^\d+$/.test(attrs.start) || Number(attrs.start)<1 || Number(attrs.start)>100000)) throw new Error("Invalid list start");
      if (tag === "code" && pre && attrs.class && !/^language-[\w+-]{1,40}$/.test(attrs.class)) throw new Error("Unsupported code language");
      const mark = tag === "a" ? (link(attrs.href) ? `a:${attrs.href}` : (() => { throw new Error("Unsupported thought link"); })())
        : ["strong", "em", "u", "s"].includes(tag) || (tag === "code" && !pre) ? tag : undefined;
      stack.push({ tag, mark });
      if (!mark && !(tag === "code" && pre)) tokens.push(["open", tag, tag === "ol" ? attrs.start ?? "1" : tag === "pre" ? "" : ""]);
      if (tag === "code" && pre && attrs.class) tokens.push(["language", attrs.class]);
    },
    ontext(text) {
      const active = stack.flatMap((s) => s.mark ? [s.mark] : []).sort();
      if (!stack.length && !text.trim()) return;
      const last = tokens.at(-1) as unknown[] | undefined;
      if (last?.[0] === "text" && last[1] === JSON.stringify(active)) last[2] = String(last[2]) + text;
      else tokens.push(["text", JSON.stringify(active), text]);
    },
    onclosetag(tag) {
      const node = stack.pop();
      if (!node?.mark && !(tag === "code" && stack.some((s) => s.tag === "pre"))) tokens.push(["close", tag]);
    },
  }, { decodeEntities: true });
  parser.write(html); parser.end();
  return JSON.stringify(tokens);
}

export function importedThought(cells: Record<string, string>): { html: string | null; json: unknown | null } {
  for (const key of ["thought", "thought_html", "thought_json"]) if (cells[key] !== undefined && invalidUnicode(cells[key])) throw new Error("Thought contains a character PostgreSQL cannot store");
  if ((cells.thought?.length ?? 0) > 200000) throw new Error("Thought is too long");
  const rich = Object.hasOwn(cells, "thought_html") || Object.hasOwn(cells, "thought_json");
  if (!rich) return { html: cells.thought ? `<p>${escape(cells.thought).replace(/\r\n|\r|\n/g, "<br>")}</p>` : null, json: null };
  if ((cells.thought_html?.length ?? 0) > 200000 || (cells.thought_json?.length ?? 0) > 400000) throw new Error("Thought is too long");
  const raw = cells.thought_html || null;
  const value: unknown = cells.thought_json ? JSON.parse(cells.thought_json) : null;
  const rendered = value === null ? null : renderThought(value);
  const clean = raw === null ? null : sanitizeCommentHtml(raw);
  if (clean !== null) canonical(clean);
  if (rendered !== null && clean !== null && canonical(rendered) !== canonical(clean)) throw new Error("Thought HTML and JSON disagree");
  return { html: clean ?? (rendered === null ? null : sanitizeCommentHtml(rendered)), json: value };
}
