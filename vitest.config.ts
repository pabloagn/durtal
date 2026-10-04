import { defineConfig } from "vitest/config";
import path from "path";
import SkippedDatabaseReporter from "./scripts/qa/skipped-database-reporter";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    reporters: ["default", new SkippedDatabaseReporter()],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
