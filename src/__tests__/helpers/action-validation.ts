import path from "node:path";
import ts from "typescript";

export interface CheckedAction {
  file: string;
  name: string;
  body: string;
  declaration: ts.FunctionDeclaration | null;
  unsupported?: string;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(modifier => modifier.kind === kind);

export function readActionModule(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const actions: CheckedAction[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const names = statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.filter(item => !item.isTypeOnly).map(item => item.name.text) : ["*"];
      for (const name of names) actions.push({ file, name, body: statement.getText(source), declaration: null,
        unsupported: "Re-exported endpoints require explicit guard support" });
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      let value = statement.expression;
      while (ts.isParenthesizedExpression(value)) value = value.expression;
      if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && hasModifier(value, ts.SyntaxKind.AsyncKeyword))
        actions.push({ file, name: "<default>", body: value.getText(source), declaration: null,
          unsupported: "Default async expressions require explicit guard support" });
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.AsyncKeyword)) {
      const supported = !!statement.name && !!statement.body && !statement.asteriskToken
        && !hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      actions.push({
        file, name: statement.name?.text ?? "<default>", body: statement.body?.getText(source) ?? "",
        declaration: supported ? statement : null,
        ...(!supported ? { unsupported: "Unsupported exported async function shape" } : {}),
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        let value = declaration.initializer;
        while (value && ts.isParenthesizedExpression(value)) value = value.expression;
        if ((value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
          && hasModifier(value, ts.SyntaxKind.AsyncKeyword)) || /^(create|update)[A-Z]/.test(declaration.name.getText(source))) {
          actions.push({ file, name: declaration.name.getText(source), body: value?.getText(source) ?? "",
            declaration: null, unsupported: "Exported async expressions require explicit guard support" });
        }
      }
    }
  }
  return { source, actions };
}

/** Never treat comments, strings, siblings or uncalled nested functions as evidence. */
function someCall(body: ts.Node | undefined, matches: (call: ts.CallExpression) => boolean): boolean {
  if (!body) return false;
  let found = false;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && matches(node)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

export function hasParserCall(action: CheckedAction): boolean {
  return someCall(action.declaration?.body, node => {
    const callee = node.expression;
    return !node.questionDotToken && ((ts.isPropertyAccessExpression(callee) && !callee.questionDotToken
      && ["parse", "safeParse"].includes(callee.name.text))
      || (ts.isIdentifier(callee) && callee.text === "parseId"));
  });
}

export function callsNamedFunction(action: CheckedAction, name: string, argument?: string): boolean {
  return someCall(action.declaration?.body, node => ts.isIdentifier(node.expression) && node.expression.text === name
    && (argument === undefined || (node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === argument)));
}

export function helperParsesInput(text: string, name: string, schema: string, exported = true): boolean {
  const source = ts.createSourceFile("helper.ts", text, ts.ScriptTarget.Latest, true);
  const helper = source.statements.find(statement => ts.isFunctionDeclaration(statement)
    && statement.name?.text === name && (!exported || hasModifier(statement, ts.SyntaxKind.ExportKeyword)));
  return !!helper && ts.isFunctionDeclaration(helper) && someCall(helper.body, node =>
    ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === schema && node.expression.name.text === "parse"
    && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === "input");
}

const keyOf = (file: string, name: string) => `${file} ${name}`;

/**
 * A bounded syntactic proof for the existing transparent adapters, not a general
 * control-flow analyser. Unsupported forwarding fails and needs explicit review.
 */
export function createDelegationProof(sources: Record<string, string>) {
  const modules = new Map(Object.entries(sources).map(([file, text]) => [file, readActionModule(file, text)]));
  const actions = new Map([...modules.values()].flatMap(module => module.actions).map(action => [keyOf(action.file, action.name), action]));
  const resolve = (file: string, specifier: string) => {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
    const base = specifier.startsWith("@/") ? specifier.slice(2) : path.posix.join(path.posix.dirname(file), specifier);
    const resolved = path.posix.normalize(base.endsWith(".ts") ? base : `${base}.ts`);
    return modules.has(resolved) ? resolved : null;
  };
  function imported(file: string, local: string, namespace: boolean) {
    const source = modules.get(file)?.source;
    if (!source) return null;
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (namespace && !statement.importClause?.isTypeOnly && bindings && ts.isNamespaceImport(bindings) && bindings.name.text === local)
        return { file: resolve(file, statement.moduleSpecifier.text), name: "*" };
      if (!namespace && bindings && ts.isNamedImports(bindings)) {
        const item = bindings.elements.find(item => item.name.text === local && !item.isTypeOnly);
        if (item && !statement.importClause?.isTypeOnly)
          return { file: resolve(file, statement.moduleSpecifier.text), name: item.propertyName?.text ?? item.name.text };
      }
    }
    return null;
  }
  function isUnwrapper(file: string, name: string) {
    const helper = modules.get(file)?.source.statements.find(statement =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    if (!helper || !ts.isFunctionDeclaration(helper) || !hasModifier(helper, ts.SyntaxKind.AsyncKeyword)
      || helper.parameters.length !== 1 || !ts.isIdentifier(helper.parameters[0].name)) return false;
    const statements = helper.body?.statements;
    if (!statements || statements.length !== 3 || !ts.isVariableStatement(statements[0])
      || statements[0].declarationList.declarations.length !== 1) return false;
    const result = statements[0].declarationList.declarations[0];
    if (!ts.isIdentifier(result.name) || !result.initializer || !ts.isAwaitExpression(result.initializer)
      || !ts.isIdentifier(result.initializer.expression)
      || result.initializer.expression.text !== helper.parameters[0].name.text) return false;
    const property = (node: ts.Node | undefined, name: string) => !!node && ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression) && node.expression.text === result.name.getText()
      && node.name.text === name;
    const refusal = statements[1], returned = statements[2];
    return ts.isIfStatement(refusal) && !refusal.elseStatement
      && ts.isPrefixUnaryExpression(refusal.expression) && refusal.expression.operator === ts.SyntaxKind.ExclamationToken
      && property(refusal.expression.operand, "ok") && ts.isThrowStatement(refusal.thenStatement)
      && ts.isNewExpression(refusal.thenStatement.expression) && ts.isIdentifier(refusal.thenStatement.expression.expression)
      && ["Error", "ActionRefusal"].includes(refusal.thenStatement.expression.expression.text)
      && refusal.thenStatement.expression.arguments?.length === 1
      && property(refusal.thenStatement.expression.arguments[0], "error")
      && ts.isReturnStatement(returned) && property(returned.expression, "value");
  }
  function targetOf(action: CheckedAction): { target?: string; error?: string } {
    const fn = action.declaration;
    if (!fn?.body || fn.parameters.length !== 1 || !fn.parameters[0].dotDotDotToken
      || !ts.isIdentifier(fn.parameters[0].name) || fn.parameters[0].initializer
      || fn.body.statements.length !== 1 || !ts.isReturnStatement(fn.body.statements[0]))
      return { error: "Not a transparent forwarding adapter" };
    const parameter = fn.parameters[0], argumentName = parameter.name.getText();
    const returned = fn.body.statements[0].expression;
    if (!returned || !ts.isCallExpression(returned) || !ts.isIdentifier(returned.expression)
      || returned.arguments.length !== 1) return { error: "Unsupported adapter return" };
    let forwarded: ts.Expression = returned.arguments[0];
    const wrapper = imported(action.file, returned.expression.text, false);
    if (wrapper?.file === "lib/actions/action-result.ts" && wrapper.name === "actionResult") {
      if (!ts.isArrowFunction(forwarded) || forwarded.parameters.length || ts.isBlock(forwarded.body))
        return { error: "Unsupported actionResult callback" };
      forwarded = forwarded.body;
    } else if (!isUnwrapper(action.file, returned.expression.text)) {
      return { error: "Unrecognised result wrapper" };
    }
    if (!ts.isCallExpression(forwarded) || !ts.isPropertyAccessExpression(forwarded.expression)
      || !ts.isIdentifier(forwarded.expression.expression) || forwarded.questionDotToken || forwarded.expression.questionDotToken
      || forwarded.arguments.length !== 1 || !ts.isSpreadElement(forwarded.arguments[0])
      || !ts.isIdentifier(forwarded.arguments[0].expression)
      || forwarded.arguments[0].expression.text !== argumentName)
      return { error: "Adapter must forward its entire argument tuple unchanged" };
    const member = forwarded.expression;
    if (argumentName === member.expression.getText() || argumentName === returned.expression.text)
      return { error: "Adapter parameter shadows an imported binding" };
    const binding = imported(action.file, member.expression.getText(), true);
    if (!binding?.file) return { error: "Unresolved adapter target import" };
    // Reject a shadowed namespace or mismatched Parameters<typeof target>.
    const type = parameter.type;
    if (!type || !ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName) || type.typeName.text !== "Parameters"
      || type.typeArguments?.length !== 1 || !ts.isTypeQueryNode(type.typeArguments[0])
      || type.typeArguments[0].exprName.getText() !== member.getText())
      return { error: "Adapter signature and runtime target differ" };
    return { target: keyOf(binding.file, member.name.text) };
  }
  // Existing reader-lock retry wrappers: the validated helper is local, not an export.
  const retryDelegates: Record<string, { target: string; schema: string }> = {
    "lib/actions/editions.ts updateEdition": { target: "updateEditionOnce", schema: "updateEditionSchema" },
    "lib/actions/reading-notes.ts updateReadingNote": { target: "updateNote", schema: "updateReadingNoteSchema" },
  };
  function retryProof(action: CheckedAction, target: string, schema: string): boolean {
    const fn = action.declaration, statements = fn?.body?.statements;
    if (!fn || !statements || statements.length !== 1 || !ts.isReturnStatement(statements[0])) return false;
    const returned = statements[0].expression;
    if (!returned || !ts.isCallExpression(returned) || !ts.isIdentifier(returned.expression) || returned.arguments.length !== 1) return false;
    const binding = imported(action.file, returned.expression.text, false);
    if (binding?.file !== "lib/reading/reader-write-locks.ts" || binding.name !== "withReaderWriteRetry") return false;
    const callback = returned.arguments[0];
    if (!ts.isArrowFunction(callback) || callback.parameters.length || !ts.isCallExpression(callback.body)
      || !ts.isIdentifier(callback.body.expression) || callback.body.expression.text !== target) return false;
    const targetCall = callback.body;
    if (targetCall.arguments.length !== fn.parameters.length || fn.parameters.some((parameter, index) =>
      !ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || parameter.initializer
      || !ts.isIdentifier(targetCall.arguments[index]) || targetCall.arguments[index].getText() !== parameter.name.text)) return false;
    return helperParsesInput(sources[action.file], target, schema, false);
  }
  function prove(key: string, visited = new Set<string>()): { chain: string[]; error?: string } {
    if (visited.has(key) || visited.size >= 8) return { chain: [key], error: "Cyclic or excessive delegation" };
    const action = actions.get(key);
    if (!action) return { chain: [key], error: "Missing exported async target" };
    if (action.unsupported) return { chain: [key], error: action.unsupported };
    if (hasParserCall(action)) return { chain: [key] };
    const retry = retryDelegates[key];
    if (retry) return retryProof(action, retry.target, retry.schema)
      ? { chain: [key, keyOf(action.file, retry.target)] }
      : { chain: [key], error: "Reviewed retry delegation no longer reaches its validating helper" };
    const target = targetOf(action);
    if (!target.target) return { chain: [key], error: target.error };
    const next = prove(target.target, new Set([...visited, key]));
    return { ...next, chain: [key, ...next.chain] };
  }
  return { actions: [...actions.values()], prove };
}
