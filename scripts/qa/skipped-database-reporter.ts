import type { Reporter, TestModule } from "vitest/node";

const INTEGRATION_DIR = "src/__tests__/integration/";

/**
 * Names every database suite that `pnpm test` skipped. The suites in
 * src/__tests__/integration/ skip themselves when no test database URL is
 * set, so a plain run passes without them (SLN-434). Only
 * `pnpm test:local` (scripts/qa/test-local.py) runs them.
 */
export default class SkippedDatabaseReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    const skipped: { suite: string; count: number }[] = [];
    for (const testModule of testModules) {
      const suite = testModule.relativeModuleId;
      if (!suite.startsWith(INTEGRATION_DIR)) continue;
      let count = 0;
      for (const test of testModule.children.allTests()) {
        if (test.result().state === "skipped") count++;
      }
      if (count > 0) skipped.push({ suite, count });
    }
    if (skipped.length === 0) return;

    const total = skipped.reduce((sum, entry) => sum + entry.count, 0);
    const lines = [
      "",
      `Skipped ${total} database tests in ${skipped.length} suites (no test database URL):`,
      ...skipped.map((entry) => `  ${entry.suite} (${entry.count})`),
      "Run every suite against a disposable PostgreSQL with: pnpm test:local",
      "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
  }
}
