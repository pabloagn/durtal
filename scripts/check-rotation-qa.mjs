// Shared by the installer, package build and Next config. No environment flag
// can permit this QA route in a production build/server.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export const QA_ROUTE = "src/app/(qa)/qa/image-rotation";
export const QA_ASSETS = "public/qa/image-rotation-fixtures";
export const QA_MARKER = ".durtal-rotation-core-proof.json";
export const QA_ROLE = "durtal-rotation-core-proof";
export const registryRoot = () =>
  join(realpathSync(tmpdir()), "durtal-rotation-core-proof-registry");
export const registrationPath = (root) =>
  join(registryRoot(), `${basename(root)}.json`);

function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function ownedJson(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("QA registration must be an owned regular file");
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Only installer-created, registered archive snapshots, never Git worktrees. */
export function verifyDisposableRotationPreview(root) {
  const target = realpathSync(resolve(root));
  const temporary = realpathSync(tmpdir());
  if (
    !target.startsWith(temporary + "/") ||
    !basename(target).startsWith(QA_ROLE + "-") ||
    present(join(target, ".git"))
  ) {
    throw new Error(
      "Rotation proof requires a registered disposable archive snapshot, not a primary or linked worktree",
    );
  }
  const marker = ownedJson(join(target, QA_MARKER));
  const registered = ownedJson(registrationPath(target));
  if (
    marker.role !== QA_ROLE ||
    marker.version !== 1 ||
    marker.root !== target ||
    !/^[0-9a-f]{40}$/.test(marker.sourceHead) ||
    JSON.stringify(marker) !== JSON.stringify(registered)
  )
    throw new Error(
      "Disposable preview registration does not match this target",
    );
  return target;
}

/** Validate both trees before any install/removal. Missing children are safe
 * only after every existing ancestor has been checked without following links. */
export function verifyRotationQaDestinations(root) {
  const target = realpathSync(root);
  function destination(path) {
    let current = target;
    for (const segment of path.split("/")) {
      current = join(current, segment);
      if (!current.startsWith(target + "/"))
        throw new Error("QA destination is outside its snapshot");
      let stat;
      try {
        stat = lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (stat.isSymbolicLink())
        throw new Error("QA destination ancestor cannot be a symlink");
      if (!stat.isDirectory() || realpathSync(current) !== current) {
        throw new Error(
          "QA destination must remain inside its snapshot directory tree",
        );
      }
    }
    return current;
  }
  return { route: destination(QA_ROUTE), assets: destination(QA_ASSETS) };
}

export function rotationQaArtifacts(root) {
  const paths = [
    QA_ROUTE,
    QA_ASSETS,
    QA_MARKER,
    ".next/server/app/qa/image-rotation",
    ".next/server/app/qa/image-rotation.html",
    ".next/server/app/qa/image-rotation.rsc",
    ".next/standalone/public/qa/image-rotation-fixtures",
  ];
  const found = paths.filter((path) => present(join(root, path)));
  for (const path of [
    ".next/app-path-routes-manifest.json",
    ".next/server/app-paths-manifest.json",
  ]) {
    if (!present(join(root, path))) continue;
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    if (
      Object.entries(manifest).some(
        ([key, value]) =>
          key.includes("/qa/image-rotation") ||
          (typeof value === "string" && value.includes("/qa/image-rotation")),
      )
    )
      found.push(path);
  }
  return found;
}

export function assertNoRotationQa(root = process.cwd()) {
  const found = rotationQaArtifacts(root);
  if (found.length)
    throw new Error(
      `Production build/server refuses rotation QA artifacts: ${found.join(", ")}. Remove the disposable proof route/assets and stale QA build output first.`,
    );
}

export function assertRotationQaConfig(phase, root = process.cwd()) {
  if (phase === "phase-development-server") {
    if (rotationQaArtifacts(root).length) verifyDisposableRotationPreview(root);
  } else assertNoRotationQa(root);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assertNoRotationQa();
}
