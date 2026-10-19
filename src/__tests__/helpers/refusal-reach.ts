import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/*
 * Which "use server" actions the screens call outside the UI adapters, and
 * which of those can refuse with an ExpectedActionError through any module
 * they call (SLN-1168). Such a refusal is hidden: Next replaces an error a
 * server action throws with its generic production sentence. A check of the
 * action's own body missed the reading import, whose refusals were raised in
 * its store and in the reading service.
 */

interface Imported {
  target: string;
  name?: string;
  namespace?: boolean;
}
interface Fn {
  throwsExpected: boolean;
  calls: [string, string?][];
}
interface Module {
  directive: "server" | "client" | null;
  imports: Map<string, Imported>;
  fns: Map<string, Fn>;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function resolver(src: string) {
  return (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? path.join(src, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((file) => existsSync(file)) ?? null;
  };
}

function parse(file: string, resolve: ReturnType<typeof resolver>): Module {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const directive = (/^\s*["']use (server|client)["']/.exec(text)?.[1] ?? null) as Module["directive"];
  const imports = new Map<string, Imported>();
  const fns = new Map<string, Fn>();
  const add = (name: string, body: ts.Node) => {
    const fn: Fn = { throwsExpected: false, calls: [] };
    const visit = (node: ts.Node) => {
      if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression) && node.expression.expression.getText() === "ExpectedActionError")
        fn.throwsExpected = true;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee)) fn.calls.push([callee.text]);
        else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) fn.calls.push([callee.expression.text, callee.name.text]);
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
    fns.set(name, fn);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolve(file, statement.moduleSpecifier.text);
      const bindings = statement.importClause.namedBindings;
      if (!target || !bindings) continue;
      if (ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { target, namespace: true });
      else for (const el of bindings.elements) if (!el.isTypeOnly) imports.set(el.name.text, { target, name: (el.propertyName ?? el.name).text });
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) add(statement.name.text, statement.body);
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) if (declaration.initializer) add(declaration.name.getText(), declaration.initializer);
  }
  return { directive, imports, fns };
}

/** "<path under src>:<action>" for each hidden refusal, with the chain that raises it */
export function hiddenRefusals(src: string): Map<string, string[]> {
  const resolve = resolver(src);
  const modules = new Map(sourceFiles(src).map((file) => [file, parse(file, resolve)]));
  const memo = new Map<string, string[] | null>();

  function raises(file: string, name: string, stack: Set<string>): string[] | null {
    const key = `${file}#${name}`;
    if (memo.has(key)) return memo.get(key)!;
    if (stack.has(key)) return null;
    stack.add(key);
    const mod = modules.get(file);
    const fn = mod?.fns.get(name);
    let found: string[] | null = null;
    if (mod && fn) {
      if (fn.throwsExpected) found = [name];
      for (const [head, member] of fn.calls) {
        if (found) break;
        if (!member && mod.fns.has(head)) {
          const inner = raises(file, head, stack);
          if (inner) found = [name, ...inner];
          continue;
        }
        const imported = mod.imports.get(head);
        const target = imported && (imported.namespace ? member : imported.name);
        if (!imported || !target) continue;
        const inner = raises(imported.target, target, stack);
        if (inner) found = [name, `${path.relative(src, imported.target)}:${target}`, ...inner.slice(1)];
      }
    }
    stack.delete(key);
    memo.set(key, found);
    return found;
  }

  const hidden = new Map<string, string[]>();
  for (const [file, mod] of modules) {
    const screen = mod.directive === "client" || (mod.directive !== "server" && /[/\\](components|hooks)[/\\]/.test(path.relative(src, file)));
    if (!screen) continue;
    for (const imported of mod.imports.values()) {
      const target = modules.get(imported.target);
      if (imported.namespace || !imported.name || target?.directive !== "server" || /-ui\.ts$/.test(imported.target)) continue;
      const chain = raises(imported.target, imported.name, new Set());
      if (chain) hidden.set(`${path.relative(src, imported.target)}:${imported.name}`, chain);
    }
  }
  return hidden;
}
