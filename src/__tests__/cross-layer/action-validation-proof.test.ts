import { describe, expect, it } from "vitest";
import { callsNamedFunction, createDelegationProof, helperParsesInput, readActionModule } from "../helpers/action-validation";

const wrapper = "lib/actions/action-result.ts";
const ui = (target = "terminal", body = "return actionResult(() => target.updateThing(...args));", signature = "target.updateThing") =>
  `import { actionResult } from "./action-result";
import * as target from "./${target}";
export async function updateThing(...args: Parameters<typeof ${signature}>) { ${body} }`;
const client = `import * as target from "./ui";
async function value(result: Promise<any>) {
  const outcome = await result;
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.value;
}
export async function updateThing(...args: Parameters<typeof target.updateThing>) {
  return value(target.updateThing(...args));
}`;
const terminal = `export async function updateThing(id: string, input: unknown) {
  parseId(id);
  const data = updateThingSchema.parse(input);
  return data;
}`;
function proof(overrides: Record<string, string> = {}, entry = "lib/actions/client.ts updateThing") {
  return createDelegationProof({
    [wrapper]: "export async function actionResult(run: () => Promise<unknown>) { return run(); }",
    "lib/actions/client.ts": client,
    "lib/actions/ui.ts": ui(),
    "lib/actions/terminal.ts": terminal,
    ...overrides,
  }).prove(entry);
}

describe("delegating action validation proof", () => {
  it("keeps reviewed helper evidence inside the called function", () => {
    const source = "export async function updateThing(input: unknown) { return parsePreferenceUpdate(input); }";
    const action = readActionModule("action.ts", source).actions[0];
    expect(callsNamedFunction(action, "parsePreferenceUpdate", "input")).toBe(true);
    expect(helperParsesInput("export function parsePreferenceUpdate(input: unknown) { return preferenceSchema.parse(input); }", "parsePreferenceUpdate", "preferenceSchema")).toBe(true);
    expect(helperParsesInput("export function parsePreferenceUpdate(input: unknown) { return input; } // preferenceSchema.parse(input)", "parsePreferenceUpdate", "preferenceSchema")).toBe(false);
    expect(helperParsesInput("export function parsePreferenceUpdate(input: unknown) { return input; } export function other(input: unknown) { return preferenceSchema.parse(input); }", "parsePreferenceUpdate", "preferenceSchema")).toBe(false);
    const comment = readActionModule("action.ts", "export async function updateThing(input: unknown) { /* parsePreferenceUpdate(input) */ return input; }").actions[0];
    expect(callsNamedFunction(comment, "parsePreferenceUpdate", "input")).toBe(false);
  });
  it("follows a client, result adapter and validating multi-argument action", () => {
    expect(proof()).toEqual({ chain: [
      "lib/actions/client.ts updateThing", "lib/actions/ui.ts updateThing", "lib/actions/terminal.ts updateThing",
    ] });
  });

  it("accepts multiline forwarding and locally resolved aliased wrapper imports", () => {
    expect(proof({ "lib/actions/ui.ts": ui().replace("{ actionResult }", "{ actionResult as result }")
      .replace("return actionResult(", "return result(\n") })).not.toHaveProperty("error");
  });

  it.each([
    ["parse", "schema.parse(input)"],
    ["safeParse", "schema.safeParse(input)"],
    ["parseId", "parseId(input)"],
  ])("accepts an actual %s call in the terminal function", (_name, call) => {
    expect(proof({ "lib/actions/terminal.ts": `export async function updateThing(input: unknown) { return ${call}; }` }))
      .not.toHaveProperty("error");
  });

  it.each([
    ["missing validator", "export async function updateThing(input: unknown) { return input; }"],
    ["comment", "export async function updateThing(input: unknown) { /* schema.parse(input) */ return input; }"],
    ["string", 'export async function updateThing(input: unknown) { return "schema.parse(input)"; }'],
    ["neighbouring function", "export async function updateThing(input: unknown) { return input; }\nexport async function validateOther(input: unknown) { return schema.parse(input); }"],
    ["uncalled nested function", "export async function updateThing(input: unknown) { function unused() { return schema.parse(input); } return input; }"],
    ["missing export", "async function updateThing(input: unknown) { return schema.parse(input); }"],
    ["optional parser", "export async function updateThing(input: unknown) { return schema.parse?.(input); }"],
    ["different target", "export async function updateOther(input: unknown) { return schema.parse(input); }"],
  ])("refuses a terminal with %s", (_name, source) => {
    expect(proof({ "lib/actions/terminal.ts": source })).toHaveProperty("error");
  });

  it.each([
    ["unresolved module", ui("missing")],
    ["dropped argument", ui("terminal", "return actionResult(() => target.updateThing(args[0]));")],
    ["reordered arguments", ui("terminal", "return actionResult(() => target.updateThing(...args.reverse()));")],
    ["replaced tuple", ui("terminal", "return actionResult(() => target.updateThing(...other));")],
    ["extra mutation", ui("terminal", "write(input); return actionResult(() => target.updateThing(...args));")],
    ["conditional bypass", ui("terminal", "if (skip) return {}; return actionResult(() => target.updateThing(...args));")],
    ["callback block", ui("terminal", "return actionResult(() => { return target.updateThing(...args); });")],
    ["signature mismatch", ui("terminal", undefined, "target.updateOther")],
    ["wrong result import", ui().replace('"./action-result"', '"./terminal"')],
    ["type-only namespace", ui().replace("import * as target", "import type * as target")],
    ["shadowed namespace", ui().replaceAll("...args", "...target")],
    ["optional invocation", ui().replace("target.updateThing(...args)", "target.updateThing?.(...args)")],
  ])("refuses %s", (_name, source) => {
    expect(proof({ "lib/actions/ui.ts": source })).toHaveProperty("error");
  });

  it("refuses an unwrapper that ignores validation rejection", () => {
    expect(proof({ "lib/actions/client.ts": client.replace("const outcome = await result;", "const outcome = {ok: true, value: 1};") }))
      .toHaveProperty("error");
  });

  it("checks an existing local retry target and unchanged arguments", () => {
    const retryModule = "lib/reading/reader-write-locks.ts";
    const text = `import { withReaderWriteRetry } from "@/lib/reading/reader-write-locks";
export async function updateEdition(id: string, input: unknown) { return withReaderWriteRetry(() => updateEditionOnce(id, input)); }
async function updateEditionOnce(id: string, input: unknown) { return updateEditionSchema.parse(input); }`;
    const inspect = (source: string) => createDelegationProof({
      [retryModule]: "export async function withReaderWriteRetry(run: () => Promise<unknown>) { return run(); }",
      "lib/actions/editions.ts": source,
    }).prove("lib/actions/editions.ts updateEdition");
    expect(inspect(text)).not.toHaveProperty("error");
    expect(inspect(text.replace("updateEditionSchema.parse(input)", "input"))).toHaveProperty("error");
    expect(inspect(text.replace("updateEditionOnce(id, input)", "updateEditionOnce(input, id)"))).toHaveProperty("error");
    expect(inspect(text.replace('"@/lib/reading/reader-write-locks"', '"./missing"'))).toHaveProperty("error");
  });

  it("refuses a cycle", () => {
    expect(proof({ "lib/actions/terminal.ts": ui("ui") })).toMatchObject({ error: "Cyclic or excessive delegation" });
  });

  it.each([
    "export const updateThing = async (input: unknown) => schema.parse(input);",
    "export const updateThing = (async function(input: unknown) { return schema.parse(input); });",
    "export default async function updateThing(input: unknown) { return schema.parse(input); }",
    "export default async (input: unknown) => schema.parse(input);",
    'export { updateThing } from "./other";',
    "export const updateThing = (async (input: unknown) => schema.parse(input)) as unknown;",
  ])("enumerates unsupported async exports instead of dropping them: %s", source => {
    const module = readActionModule("lib/actions/terminal.ts", source);
    expect(module.actions).toHaveLength(1);
    expect(module.actions[0].unsupported).toBeTruthy();
    expect(proof({ "lib/actions/terminal.ts": source })).toHaveProperty("error");
  });
});
