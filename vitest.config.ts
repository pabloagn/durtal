import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Placeholders for the variables src/lib/env.ts requires. The host never
    // resolves, so no test can reach a real database through DATABASE_URL.
    env: {
      DATABASE_URL: "postgresql://placeholder@db.invalid/placeholder",
      AWS_ACCESS_KEY_ID: "test",
      AWS_SECRET_ACCESS_KEY: "test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
