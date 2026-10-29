import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// Editable native fields below 16px zoom iOS on focus. Shared controls own
// their sizing; literal native small-text styles must name a touch override.
it("gives small native fields a coarse-pointer text size", () => {
  const failures: string[] = [];
  function check(file: string) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (["input", "textarea", "select"].includes(tag)) {
          const attribute = (name: string) => node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(source) === name);
          const type = attribute("type")?.initializer?.getText(source) ?? "";
          const classes = attribute("className")?.initializer?.getText(source) ?? "";
          if (!/checkbox|radio|hidden|file|range|color/.test(type)
            && /(?:^|[\s"'`])text-(?:xs|xxs|micro)(?:[\s"'`]|$)/.test(classes)
            && !/pointer-coarse:text-(?:sm|base|lg|xl)/.test(classes)) {
            failures.push(`${path.relative(process.cwd(), file)}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".tsx")) check(file);
    }
  }
  walk(path.join(process.cwd(), "src"));
  expect(failures).toEqual([]);
});
