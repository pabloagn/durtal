import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import {
  QA_ROUTE,
  QA_ASSETS,
  QA_MARKER,
  QA_ROLE,
  registrationPath,
  registryRoot,
  verifyDisposableRotationPreview,
  verifyRotationQaDestinations,
  assertNoRotationQa,
  assertRotationQaConfig,
} from "../../../scripts/check-rotation-qa.mjs";
import nextConfig from "../../../next.config";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), QA_ROLE + "-test-"));
});
afterEach(() => {
  rmSync(registrationPath(root), { force: true });
  rmSync(root, { recursive: true, force: true });
});
function register() {
  const marker = JSON.stringify({
    version: 1,
    role: QA_ROLE,
    root,
    sourceRoot: process.cwd(),
    sourceHead: "a".repeat(40),
  });
  mkdirSync(registryRoot(), { recursive: true });
  writeFileSync(join(root, QA_MARKER), marker);
  writeFileSync(registrationPath(root), marker);
}
function artifact(path: string, body = "{}") {
  const full = join(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, body);
}
describe("rotation QA isolation without installing a route or running a build", () => {
  it("accepts a clean normal source tree in every phase", () => {
    for (const phase of [
      "phase-development-server",
      "phase-production-build",
      "phase-production-server",
    ])
      expect(() => assertRotationQaConfig(phase, root)).not.toThrow();
  });
  it.each([
    QA_ROUTE,
    QA_ASSETS,
    QA_MARKER,
    ".next/server/app/qa/image-rotation.html",
    ".next/server/app/qa/image-rotation.rsc",
    ".next/standalone/public/qa/image-rotation-fixtures",
  ])(
    "blocks production on source/public/marker/compiled artifact %s",
    (path) => {
      artifact(path);
      expect(() => assertNoRotationQa(root)).toThrow(
        "Production build/server refuses",
      );
      expect(() =>
        assertRotationQaConfig("phase-production-build", root),
      ).toThrow();
      expect(() =>
        assertRotationQaConfig("phase-production-server", root),
      ).toThrow();
    },
  );
  it("also catches a dangling QA artifact symlink", () => {
    const assets = join(root, QA_ASSETS);
    mkdirSync(resolve(assets, ".."), { recursive: true });
    symlinkSync("/nonexistent-rotation-fixture", assets);
    expect(() => assertNoRotationQa(root)).toThrow(
      "Production build/server refuses",
    );
  });
  it.each([
    [
      ".next/app-path-routes-manifest.json",
      { "/(qa)/qa/image-rotation/page": "/qa/image-rotation" },
    ],
    [
      ".next/server/app-paths-manifest.json",
      { "/qa/image-rotation/page": "app/qa/image-rotation/page.js" },
    ],
  ] as const)(
    "rejects stale compiled route manifest %s after source removal",
    (path, manifest) => {
      artifact(path, JSON.stringify(manifest));
      expect(() => assertNoRotationQa(root)).toThrow(
        "Production build/server refuses",
      );
    },
  );
  it("allows only registered disposable snapshots in development, never in production", () => {
    register();
    expect(verifyDisposableRotationPreview(root)).toBe(root);
    expect(() =>
      assertRotationQaConfig("phase-development-server", root),
    ).not.toThrow();
    for (const phase of [
      "phase-production-build",
      "phase-production-server",
      "unknown-phase",
    ])
      expect(() => assertRotationQaConfig(phase, root)).toThrow(
        "Production build/server refuses",
      );
  });
  it.each(["directory", "file"])(
    "rejects primary/linked Git checkout marker %s even with a valid registration",
    (kind) => {
      register();
      if (kind === "directory") mkdirSync(join(root, ".git"));
      else writeFileSync(join(root, ".git"), "gitdir: /ignored/worktree");
      expect(() => verifyDisposableRotationPreview(root)).toThrow(
        "not a primary or linked worktree",
      );
    },
  );
  it("refuses a forged/missing registry and a registration copied to another target", () => {
    register();
    rmSync(registrationPath(root));
    expect(() => verifyDisposableRotationPreview(root)).toThrow();
    register();
    const other = JSON.parse(readFileSync(join(root, QA_MARKER), "utf8"));
    other.root = "/different/target";
    writeFileSync(join(root, QA_MARKER), JSON.stringify(other));
    expect(() => verifyDisposableRotationPreview(root)).toThrow(
      "does not match",
    );
  });
  it("rejects a registration symlink", () => {
    register();
    rmSync(registrationPath(root));
    symlinkSync(join(root, QA_MARKER), registrationPath(root));
    expect(() => verifyDisposableRotationPreview(root)).toThrow(
      "owned regular file",
    );
  });
  it("package guard exits before any vendor or Next build job on an artifact", () => {
    artifact(QA_ASSETS);
    const script = resolve("scripts/check-rotation-qa.mjs");
    expect(() =>
      execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" }),
    ).toThrow();
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts.build).toMatch(/^node scripts\/check-rotation-qa\.mjs &&/);
  });
  it("Next config calls the guard for direct build/server paths", () => {
    const previous = process.cwd();
    // Call the exported config against a simulated source root without Next.
    try {
      process.chdir(root);
      artifact(QA_ROUTE);
      expect(() => nextConfig("phase-production-build")).toThrow(
        "Production build/server refuses",
      );
      expect(() => nextConfig("phase-production-server")).toThrow(
        "Production build/server refuses",
      );
    } finally {
      process.chdir(previous);
    }
  });
  it("Docker excludes source/public QA artifacts and retains the production guard", () => {
    const ignore = readFileSync(".dockerignore", "utf8").split("\n");
    expect(ignore).toContain(QA_ROUTE);
    expect(ignore).toContain(QA_ASSETS);
    expect(ignore).toContain(QA_MARKER);
    expect(ignore).toContain("!scripts/check-rotation-qa.mjs");
  });
  it("accepts absent destinations in a checked directory tree without creating children", () => {
    register();
    mkdirSync(join(root, "src/app"), { recursive: true });
    const before = readdirSync(root, { recursive: true }).sort();
    expect(verifyRotationQaDestinations(root)).toEqual({
      route: join(root, QA_ROUTE),
      assets: join(root, QA_ASSETS),
    });
    expect(readdirSync(root, { recursive: true }).sort()).toEqual(before);
  });
  const ancestors = [
    "src",
    "src/app",
    "src/app/(qa)",
    "src/app/(qa)/qa",
    QA_ROUTE,
    "public",
    "public/qa",
    QA_ASSETS,
  ];
  it.each(
    ancestors.flatMap((ancestor) =>
      ["install", "remove"].map((mode) => [ancestor, mode]),
    ),
  )(
    "rejects %s ancestor traversal during %s before touching external or safe sibling artifacts",
    (ancestor, mode) => {
      register();
      const external = mkdtempSync(
        join(realpathSync(tmpdir()), "rotation-external-sentinel-"),
      );
      const badPath = join(root, ancestor),
        endpoint = ancestor.startsWith("src") ? QA_ROUTE : QA_ASSETS;
      const safeEndpoint = endpoint === QA_ROUTE ? QA_ASSETS : QA_ROUTE;
      const inside = join(root, safeEndpoint, "inside-sentinel.txt");
      mkdirSync(resolve(inside, ".."), { recursive: true });
      writeFileSync(inside, "owned snapshot sentinel");
      mkdirSync(resolve(badPath, ".."), { recursive: true });
      symlinkSync(external, badPath, "dir");
      try {
        // Exercise absent final children as well as existing external QA
        // directories that the old --remove path would recursively delete.
        for (const exists of [false, true]) {
          const outsideEndpoint = join(external, relative(ancestor, endpoint));
          const sentinel = join(external, "external-sentinel.txt");
          writeFileSync(sentinel, "external bytes must stay unchanged");
          let nested: string | undefined;
          if (exists) {
            mkdirSync(outsideEndpoint, { recursive: true });
            nested = join(outsideEndpoint, "nested-sentinel.txt");
            writeFileSync(nested, "external QA must not be removed");
          }
          const before = readdirSync(external, { recursive: true }).sort();
          const result = spawnSync(
            process.execPath,
            [
              resolve("scripts/qa/prepare-rotation-proof.mjs"),
              "--disposable-root",
              root,
              ...(mode === "remove" ? ["--remove"] : []),
            ],
            { encoding: "utf8" },
          );
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(
            "QA destination ancestor cannot be a symlink",
          );
          expect(readFileSync(sentinel, "utf8")).toBe(
            "external bytes must stay unchanged",
          );
          if (nested)
            expect(readFileSync(nested, "utf8")).toBe(
              "external QA must not be removed",
            );
          expect(readdirSync(external, { recursive: true }).sort()).toEqual(
            before,
          );
          expect(readFileSync(inside, "utf8")).toBe("owned snapshot sentinel");
          if (!exists && relative(ancestor, endpoint))
            expect(existsSync(outsideEndpoint)).toBe(false);
        }
      } finally {
        rmSync(external, { recursive: true, force: true });
      }
    },
  );
  it("rejects a dangling destination ancestor before install and removal", () => {
    register();
    mkdirSync(join(root, "public"));
    symlinkSync(join(root, "missing-tree"), join(root, "public/qa"), "dir");
    for (const mode of [[], ["--remove"]]) {
      const result = spawnSync(
        process.execPath,
        [
          resolve("scripts/qa/prepare-rotation-proof.mjs"),
          "--disposable-root",
          root,
          ...mode,
        ],
        { encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "QA destination ancestor cannot be a symlink",
      );
      expect(existsSync(join(root, "missing-tree"))).toBe(false);
      expect(existsSync(join(root, QA_ROUTE))).toBe(false);
    }
  });
});
