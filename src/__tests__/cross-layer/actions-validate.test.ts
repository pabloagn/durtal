import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Server actions are public HTTP endpoints: every exported create*/update* action must
// validate its input (a Zod `.parse(...)` or `parseId(...)` in its body).

const SRC = path.resolve(__dirname, "../..");
const ACTIONS_DIR = path.join(SRC, "lib/actions");
const VALIDATIONS_DIR = path.join(SRC, "lib/validations");

function exportedFunctions(file: string): { name: string; body: string }[] {
  const source = readFileSync(file, "utf8");
  const starts = [...source.matchAll(/^export async function (\w+)\s*\(/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

const actionFiles = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(ACTIONS_DIR, f));

const mutating = actionFiles.flatMap((file) =>
  exportedFunctions(file)
    .filter((fn) => /^(create|update)[A-Z]/.test(fn.name))
    .map((fn) => ({ ...fn, file: path.relative(SRC, file) })),
);

describe("server action input validation", () => {
  it("finds the mutating actions to check", () => {
    expect(mutating.length).toBeGreaterThan(20);
  });

  it.each(mutating.map((m) => [`${m.file} ${m.name}`, m]))("%s validates its input", (_label, action) => {
    expect(action.body).toMatch(/\.parse\(|parseId\(/);
  });

  it("leaves no update*Schema unused", () => {
    const schemaNames = readdirSync(VALIDATIONS_DIR)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => [...readFileSync(path.join(VALIDATIONS_DIR, f), "utf8").matchAll(/^export const (update\w*Schema)\b/gm)].map((m) => m[1]));
    const appSources = actionFiles.map((f) => readFileSync(f, "utf8")).join("\n") +
      readdirSync(path.join(SRC, "app/api"), { recursive: true })
        .filter((f) => String(f).endsWith(".ts"))
        .map((f) => readFileSync(path.join(SRC, "app/api", String(f)), "utf8"))
        .join("\n");
    const unused = schemaNames.filter((name) => !new RegExp(`\\b${name}\\b`).test(appSources));
    expect(unused).toEqual([]);
  });
});
