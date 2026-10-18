import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// A busy Button reads as off but is never `disabled`, which drops the
// keyboard focus to the page (SLN-853). The review of #423 found buttons that
// still put their own busy flag into `disabled` (SLN-867): this keeps any
// from coming back. A flag the button is busy with must not disable it.

const SRC = path.resolve(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : files(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

/** Each `<Button …>` opening tag's attributes, braces counted so `=>` doesn't end it */
function buttonTags(text: string): { line: number; attrs: string }[] {
  const tags: { line: number; attrs: string }[] = [];
  for (const match of text.matchAll(/<Button\b/g)) {
    let depth = 0;
    let i = match.index! + match[0].length;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push({ line: text.slice(0, match.index).split("\n").length, attrs: text.slice(match.index! + match[0].length, i) });
  }
  return tags;
}

/** A JSX attribute's expression, braces counted */
function attr(attrs: string, name: string): string | null {
  const start = attrs.search(new RegExp(`(?<![\\w-])${name}=\\{`));
  if (start < 0) return null;
  let depth = 0;
  let i = attrs.indexOf("{", start);
  const from = i + 1;
  for (; i < attrs.length; i++) {
    if (attrs[i] === "{") depth++;
    else if (attrs[i] === "}" && --depth === 0) break;
  }
  return attrs.slice(from, i);
}

describe("a busy button", () => {
  it("never disables itself with the flag it is busy with", () => {
    const found: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      const expressions = new Map([...source.matchAll(/\bconst\s+(\w+)\s*=\s*([^;]+);/g)].map((match) => [match[1], match[2]]));
      const containsFlag = (expression: string, flag: string, seen = new Set<string>()): boolean =>
        [...expression.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].some(([name]) => {
          if (name === flag) return true;
          if (seen.has(name) || !expressions.has(name)) return false;
          return containsFlag(expressions.get(name)!, flag, new Set([...seen, name]));
        });
      for (const { line, attrs } of buttonTags(source)) {
        const busy = attr(attrs, "busy");
        const disabled = attr(attrs, "disabled");
        if (!busy || !disabled) continue;
        const busy1 = busy.trim();
        const disabled1 = disabled.trim();
        // The same flag, or one alternative of an "||"
        const parts = disabled1.split("||").map((part) => part.trim().replace(/^!!/, ""));
        if (parts.includes(busy1) || (/^[A-Za-z_$][\w$]*$/.test(busy1) && containsFlag(disabled1, busy1))) found.push(`${path.relative(SRC, file)}:${line}: busy={${busy1}} disabled={${disabled1}}`);
      }
    }
    expect(found).toEqual([]);
  });
});
