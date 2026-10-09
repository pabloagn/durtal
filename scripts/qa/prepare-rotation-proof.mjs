#!/usr/bin/env node
// Source preparation only. No server, database, build or browser is launched.
// Install in the root-granted disposable QA checkout; remove before final build.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const at = process.argv.indexOf("--disposable-root");
if (at < 0 || !process.argv[at + 1])
  throw new Error(
    "Explicit --disposable-root required; primary checkout installation is refused",
  );
const target = realpathSync(resolve(process.argv[at + 1]));
const git = resolve(target, ".git");
const linkedWorktree = existsSync(git) && lstatSync(git).isFile();
if (!linkedWorktree && !target.startsWith(realpathSync(tmpdir()) + "/"))
  throw new Error(
    "Only a linked QA worktree or disposable temporary source snapshot is supported",
  );
const route = resolve(target, "src/app/(qa)/qa/image-rotation");
const assets = resolve(target, "public/qa/image-rotation-fixtures");
if (process.argv.includes("--remove")) {
  rmSync(route, { recursive: true, force: true });
  rmSync(assets, { recursive: true, force: true });
} else {
  if (existsSync(route) || existsSync(assets))
    throw new Error("QA route/assets already exist; inspect before replacing");
  mkdirSync(route, { recursive: true });
  copyFileSync(
    resolve("scripts/qa/rotation-proof-page.tsx"),
    resolve(route, "page.tsx"),
  );
  cpSync(resolve("src/__tests__/fixtures/image-rotation"), assets, {
    recursive: true,
  });
}
