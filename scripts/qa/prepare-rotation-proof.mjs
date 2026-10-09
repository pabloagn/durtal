#!/usr/bin/env node
// Run only after root's heavy grant. Creates/installs into registered temporary
// archive snapshots only. Never installs in primary or linked worktrees.
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  QA_MARKER,
  QA_ROLE,
  registryRoot,
  registrationPath,
  verifyDisposableRotationPreview,
  verifyRotationQaDestinations,
} from "../check-rotation-qa.mjs";

const source = realpathSync(process.cwd());
if (process.argv.includes("--create-disposable")) {
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  const archive = execFileSync("git", ["archive", sourceHead], {
    cwd: source,
    maxBuffer: 100 * 1024 * 1024,
  });
  const target = mkdtempSync(join(realpathSync(tmpdir()), QA_ROLE + "-"));
  try {
    execFileSync("tar", ["-x", "-C", target], { input: archive });
    // Reuse existing dependencies; this performs no install or package job.
    symlinkSync(
      join(source, "node_modules"),
      join(target, "node_modules"),
      "dir",
    );
    const marker = {
      version: 1,
      role: QA_ROLE,
      root: target,
      sourceRoot: source,
      sourceHead,
    };
    const bytes = JSON.stringify(marker, null, 2) + "\n";
    mkdirSync(registryRoot(), { recursive: true, mode: 0o700 });
    writeFileSync(join(target, QA_MARKER), bytes, { flag: "wx", mode: 0o600 });
    writeFileSync(registrationPath(target), bytes, { flag: "wx", mode: 0o600 });
    console.log(target);
  } catch (error) {
    rmSync(registrationPath(target), { force: true });
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
} else {
  const at = process.argv.indexOf("--disposable-root");
  if (at < 0 || !process.argv[at + 1])
    throw new Error(
      "Create a registered snapshot with --create-disposable, then supply --disposable-root",
    );
  const target = verifyDisposableRotationPreview(process.argv[at + 1]);
  // Check both complete paths first: an unsafe asset tree must not allow the
  // otherwise-safe route to be created/deleted before the operation rejects.
  const { route, assets } = verifyRotationQaDestinations(target);
  if (process.argv.includes("--remove")) {
    rmSync(route, { recursive: true, force: true });
    rmSync(assets, { recursive: true, force: true });
  } else {
    if (existsSync(route) || existsSync(assets))
      throw new Error(
        "QA route/assets already exist; inspect before replacing",
      );
    mkdirSync(route, { recursive: true });
    copyFileSync(
      join(target, "scripts/qa/rotation-proof-page.tsx"),
      join(route, "page.tsx"),
    );
    cpSync(join(target, "src/__tests__/fixtures/image-rotation"), assets, {
      recursive: true,
    });
  }
}
