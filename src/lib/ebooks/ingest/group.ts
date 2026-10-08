import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

/*
 * Which files a run looks at and which belong together (SLN-494).
 *
 * - A folder with a sidecar `metadata.opf` is one e-book: every e-book file
 *   in it is one of its formats.
 * - Elsewhere, files in one folder with the same base name ("Nadja.epub",
 *   "Nadja.pdf") are one e-book; every other file is its own.
 * - The same bytes at two paths are stored once: the first path keeps the
 *   file (a path inside a sidecar folder first), the others are duplicates.
 *
 * Hidden files, .DS_Store, sidecars, cover.jpg and symlinks that lead
 * outside the roots are never looked at. Durtal never moves, changes or
 * deletes a file it finds.
 */

export const SIDECAR_NAME = "metadata.opf";

export interface FoundFile {
  /** The path as found under its root */
  path: string;
  root: string;
  folder: string;
  name: string;
  size: number;
  mtimeMs: number;
  ino: number;
}

export interface WalkResult {
  files: FoundFile[];
  /** Folder → its sidecar's path */
  sidecars: Map<string, string>;
}

const skippedName = (name: string) => name.startsWith(".") || name.toLowerCase() === "cover.jpg" || name.toLowerCase().endsWith(".opf");
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Every file under the roots, in path order */
export async function walkRoots(roots: string[], options: { exclude?: string[] } = {}): Promise<WalkResult> {
  const realRoots = await Promise.all(roots.map((root) => realpath(root)));
  const files: FoundFile[] = [];
  const sidecars = new Map<string, string>();
  const visited = new Set<string>();
  const excluded = (root: string, file: string) => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    return (options.exclude ?? []).some((glob) => path.matchesGlob(relative, glob));
  };

  const walk = async (root: string, folder: string) => {
    const real = await realpath(folder);
    if (visited.has(real)) return;
    visited.add(real);
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.name.toLowerCase() === SIDECAR_NAME && entry.isFile()) {
        sidecars.set(folder, full);
        continue;
      }
      if (skippedName(entry.name) || excluded(root, full)) continue;
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        const target = await realpath(full).catch(() => null);
        if (!target || !realRoots.some((r) => inside(target, r))) continue;
        const info = await stat(target);
        isDirectory = info.isDirectory();
        isFile = info.isFile();
      }
      if (isDirectory) await walk(root, full);
      else if (isFile) {
        const info = await stat(full);
        files.push({ path: full, root, folder, name: entry.name, size: info.size, mtimeMs: info.mtimeMs, ino: info.ino });
      }
    }
  };

  for (const root of roots) {
    const info = await lstat(root);
    if (!info.isDirectory() && !info.isSymbolicLink()) throw new Error(`${root} is not a folder`);
    await walk(root, path.resolve(root));
  }
  return { files, sidecars };
}

/** "Nadja.epub" → "nadja"; "Nadja.kepub.epub" → "nadja" */
export function baseName(name: string): string {
  return name.replace(/(\.kepub)?\.[^.]+$/i, "").toLowerCase();
}

export interface GroupCandidate {
  path: string;
  folder: string;
  name: string;
  sha256: string;
  /** Whether its folder has a sidecar OPF */
  sidecar: boolean;
}

export interface FileGroup {
  key: string;
  folder: string;
  sidecar: boolean;
  /** The paths stored for this e-book, in path order */
  paths: string[];
}

/** E-book files into groups; the same bytes twice into one stored path and its duplicates */
export function groupFiles(files: GroupCandidate[]): { groups: FileGroup[]; duplicates: Map<string, string> } {
  // The first path of each checksum: one in a sidecar folder first, then path order
  const ordered = [...files].sort((a, b) => Number(b.sidecar) - Number(a.sidecar) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const first = new Map<string, string>();
  const duplicates = new Map<string, string>();
  for (const file of ordered) {
    const kept = first.get(file.sha256);
    if (kept) duplicates.set(file.path, kept);
    else first.set(file.sha256, file.path);
  }

  const groups = new Map<string, FileGroup>();
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (duplicates.has(file.path)) continue;
    const key = file.sidecar ? `sidecar:${file.folder}` : `name:${file.folder}${path.sep}${baseName(file.name)}`;
    const group = groups.get(key) ?? { key, folder: file.folder, sidecar: file.sidecar, paths: [] };
    group.paths.push(file.path);
    groups.set(key, group);
  }
  return { groups: [...groups.values()], duplicates };
}
