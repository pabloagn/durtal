import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { callsNamedFunction, createDelegationProof, hasParserCall, helperParsesInput } from "../helpers/action-validation";

// Server actions are public HTTP endpoints: every exported create*/update* action must
// validate its input directly, through a reviewed helper, or through a proven forwarding chain.

const SRC = path.resolve(__dirname, "../..");
const ACTIONS_DIR = path.join(SRC, "lib/actions");
const VALIDATIONS_DIR = path.join(SRC, "lib/validations");

/** Actions that only hand their input to another validating action of the same file. */
const DELEGATES: Record<string, string> = {
  "lib/actions/publishers.ts createPublisherFromName": "savePublisher",
};
/** Reviewed shared parser: the action must call it and it must use its schema. */
const HELPER_VALIDATORS: Record<string, { helper: string; module: string; schema: string }> = {
  "lib/actions/reader-preferences.ts updateReaderPreferences": {
    helper: "parsePreferenceUpdate", module: "lib/reader/presentation/preference-plan.ts",
    schema: "updateReaderPreferencesSchema",
  },
};

const actionFiles = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(ACTIONS_DIR, f));

const sources = Object.fromEntries(actionFiles.map(file => [path.relative(SRC, file).split(path.sep).join("/"), readFileSync(file, "utf8")]));
// These two existing actions validate inside an audited local reader-lock retry.
sources["lib/reading/reader-write-locks.ts"] = readFileSync(path.join(SRC, "lib/reading/reader-write-locks.ts"), "utf8");
const validation = createDelegationProof(sources);
const actions = validation.actions;
const mutating = actions.filter((fn) => /^(create|update)[A-Z]/.test(fn.name));

describe("server action input validation", () => {
  it("does not silently omit unsupported exported async shapes", () => {
    expect(actions.filter(action => action.unsupported).map(action => `${action.file} ${action.name}: ${action.unsupported}`)).toEqual([]);
  });
  it("finds the mutating actions to check", () => {
    expect(mutating.length).toBeGreaterThan(40);
  });

  it.each(mutating.map((m) => [`${m.file} ${m.name}`, m]))("%s validates its input", (_label, action) => {
    const delegate = DELEGATES[`${action.file} ${action.name}`];
    const validator = HELPER_VALIDATORS[`${action.file} ${action.name}`];
    if (validator) {
      expect(callsNamedFunction(action, validator.helper, "input")).toBe(true);
      const actionSource = readFileSync(path.join(SRC, action.file), "utf8");
      expect(actionSource).toContain(`from "@/${validator.module.replace(/\.ts$/, "")}"`);
      const parserSource = readFileSync(path.join(SRC, validator.module), "utf8");
      expect(parserSource).toContain(`export function ${validator.helper}(input: unknown)`);
      expect(helperParsesInput(parserSource, validator.helper, validator.schema)).toBe(true);
    } else if (delegate) {
      expect(callsNamedFunction(action, delegate)).toBe(true);
      const target = actions.find((fn) => fn.file === action.file && fn.name === delegate);
      expect(target && hasParserCall(target)).toBe(true);
    } else {
      const proof = validation.prove(`${action.file} ${action.name}`);
      // A UI adapter's chain may end at a reviewed delegation (SLN-1033)
      const end = proof.chain.at(-1)!;
      const delegated = proof.error ? DELEGATES[end] : undefined;
      if (delegated) {
        const [file, name] = end.split(" ");
        const forwarded = actions.find((fn) => fn.file === file && fn.name === name)!;
        expect(callsNamedFunction(forwarded, delegated)).toBe(true);
        const target = actions.find((fn) => fn.file === file && fn.name === delegated);
        expect(target && hasParserCall(target)).toBe(true);
      } else {
        expect(proof.error, proof.chain.join(" → ")).toBeUndefined();
      }
    }
  });

  it("leaves no update*Schema unused", () => {
    const schemaNames = readdirSync(VALIDATIONS_DIR)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => [...readFileSync(path.join(VALIDATIONS_DIR, f), "utf8").matchAll(/^export const (update\w*Schema)\b/gm)].map((m) => m[1]));
    const appSources =
      actionFiles.map((f) => readFileSync(f, "utf8")).join("\n") +
      Object.values(HELPER_VALIDATORS).map(({ module }) => readFileSync(path.join(SRC, module), "utf8")).join("\n") +
      readdirSync(path.join(SRC, "app/api"), { recursive: true })
        .filter((f) => String(f).endsWith(".ts"))
        .map((f) => readFileSync(path.join(SRC, "app/api", String(f)), "utf8"))
        .join("\n");
    const unused = schemaNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(appSources));
    expect(unused).toEqual([]);
  });
});
