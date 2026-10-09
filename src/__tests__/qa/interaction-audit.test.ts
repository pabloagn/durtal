import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("interaction audit discovers nested controls, detects broken focus, restores state and refuses unsafe hosts", () => {
  const report = execFileSync(
    process.execPath,
    ["--test", "--test-reporter=tap", "scripts/qa/interaction-audit.test.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  expect(report).toContain("# pass 12");
  expect(report).toContain("# fail 0");
  expect(report).toContain("# skipped 0");
});
