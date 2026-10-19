import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Build-only: compile the worker and its sources into one JavaScript file when
// the image is built, so nothing loads or compiles TypeScript inside the
// bounded container. tsx's esbuild did that at run time, and its threads with
// Node's ran into --pids-limit=16 ("failed to create new OS thread"). Packages
// stay imports of the image's node_modules. No new npm package: esbuild is the
// one tsx already brings.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const fromTsx = createRequire(realpathSync(createRequire(import.meta.url).resolve("tsx/package.json")));
const { build } = fromTsx("esbuild");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/lib/ebooks/upload/worker-entry.ts"],
  outfile: process.argv[2] ?? "dist/inspector/inspector.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  // As tsx ran it before: ES2022 class fields, and "@/" is src
  tsconfigRaw: { compilerOptions: { target: "ES2022", useDefineForClassFields: true, baseUrl: ".", paths: { "@/*": ["./src/*"] } } },
  metafile: true,
  logLevel: "warning",
});
// The image copies src/lib only, and build-inspector checks only it is committed
const outside = Object.keys(result.metafile.inputs).filter((input) => !input.startsWith("src/lib/"));
if (outside.length) throw new Error(`The inspector compiles files outside src/lib: ${outside.join(", ")}`);
