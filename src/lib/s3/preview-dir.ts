import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/*
 * The disposable preview's S3 (SLN-450): with DURTAL_PREVIEW_S3_DIR, set only
 * by `scripts/qa/preview-local.py --s3-dir DIR` for one run, uploadToS3,
 * getS3Object and deleteFromS3 keep objects as files under DIR, the key as
 * the path, and the delete cleanup lists and batch-deletes them (SLN-549).
 * Never set in .env, the Dockerfile or docker-compose.yml.
 */

const TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".csv": "text/csv",
  ".epub": "application/epub+zip",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4b": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".webp": "image/webp",
};

/** The folder, when the preview set one */
export function previewS3Dir(): string | null {
  return process.env.DURTAL_PREVIEW_S3_DIR || null;
}

/** The file of a key: refused when the key would leave the folder */
export function previewObjectPath(dir: string, key: string): string {
  if (!key || key.startsWith("/") || key.split(/[\\/]/).includes("..")) throw new Error(`Refused: the key "${key.slice(0, 200)}" leaves the preview folder`);
  const root = path.resolve(dir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error(`Refused: the key "${key.slice(0, 200)}" leaves the preview folder`);
  return full;
}

export async function previewPut(dir: string, key: string, body: Buffer | Uint8Array) {
  const file = previewObjectPath(dir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return key;
}

/** The object as the SDK gives it: a body with transformToWebStream and transformToByteArray; a missing file fails like NoSuchKey */
export async function previewGet(dir: string, key: string) {
  const file = previewObjectPath(dir, key);
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey", Code: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    }
    throw err;
  }
  const array = () => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    body: {
      transformToByteArray: async () => array(),
      transformToString: async (encoding = "utf-8") => new TextDecoder(encoding).decode(array()),
      transformToWebStream: () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(array());
            controller.close();
          },
        }),
    },
    contentType: TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    contentLength: bytes.byteLength,
  };
}

export async function previewDelete(dir: string, key: string) {
  await rm(previewObjectPath(dir, key), { force: true });
}

/** The keys that start with a prefix, as ListObjectsV2 lists them; the walk starts at the prefix's last folder */
export async function previewList(dir: string, prefix: string): Promise<string[]> {
  const root = path.resolve(dir);
  const folder = prefix.includes("/") ? previewObjectPath(dir, prefix.slice(0, prefix.lastIndexOf("/"))) : root;
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return [];
    throw err;
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .filter((key) => key.startsWith(prefix))
    .sort();
}

/** Several objects, as DeleteObjects answers: a missing key counts as deleted, a key it could not delete is in Errors */
export async function previewDeleteMany(dir: string, keys: string[]) {
  const Errors: { Key: string; Message: string }[] = [];
  for (const key of keys) {
    try {
      await previewDelete(dir, key);
    } catch (err) {
      Errors.push({ Key: key, Message: (err as Error).message });
    }
  }
  return { Errors };
}
