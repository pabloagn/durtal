/**
 * The environment of the e-book commands (SLN-494): the env files, or with
 * `--preview PORT` a running disposable preview (scripts/qa/preview-local.py
 * --port PORT --s3-dir DIR): its database through the same Neon bridge the
 * preview's app loads, and its S3 folder as the bucket. A preview never
 * reads an env file, so no live database or AWS key is ever in reach.
 */
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";

export async function loadEnvironment(options: { preview?: string; envDir: string }): Promise<{ url: string; preview: boolean }> {
  if (!options.preview) {
    dotenv.config({ path: [resolve(options.envDir, ".env.local"), resolve(options.envDir, ".env")], quiet: true });
    const url = process.env.PREVIEW_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    return { url, preview: false };
  }
  const port = options.preview;
  if (!/^\d+$/.test(port)) throw new Error(`--preview takes the preview's port, such as 3410`);
  const stateFile = resolve(tmpdir(), `durtal-preview-${port}.json`);
  if (!existsSync(stateFile))
    throw new Error(`No preview is running on port ${port}: start one with python3 scripts/qa/preview-local.py --port ${port} --s3-dir DIR`);
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as { databaseUrl: string; s3Dir: string | null };
  if (!state.s3Dir) throw new Error(`The preview on port ${port} has no --s3-dir: restart it with --s3-dir DIR, so its e-books have a bucket`);
  delete process.env.PREVIEW_DATABASE_URL;
  Object.assign(process.env, {
    DATABASE_URL: state.databaseUrl,
    DURTAL_PREVIEW_S3_DIR: state.s3Dir,
    EBOOK_DELIVERY: "app",
    // src/lib/env.ts needs AWS keys; these are none, and the preview's folder is the bucket
    AWS_ACCESS_KEY_ID: "preview-no-s3",
    AWS_SECRET_ACCESS_KEY: "preview-no-s3",
  });
  await import(pathToFileURL(resolve(import.meta.dirname, "../qa/neon-local-bridge.mjs")).href);
  return { url: state.databaseUrl, preview: true };
}
