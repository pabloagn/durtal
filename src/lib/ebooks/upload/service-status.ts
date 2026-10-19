import path from "node:path";
import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod/v4";

/**
 * Why the upload service is down, when it knows (SLN-1326). The service
 * writes it beside its socket before it exits and clears it once it is
 * ready, so the app can say "sign in again" instead of "not running".
 */
export const UPLOAD_SIGN_IN_MESSAGE = "Uploads need the Mac to sign in to AWS again.";

const statusSchema = z.object({ version: z.literal(1), reason: z.literal("aws_sign_in"), at: z.string().max(64) }).strict();
export type UploadServiceDownReason = z.infer<typeof statusSchema>["reason"];

/** The status file sits in the socket's private run folder */
export const uploadServiceStatusPath = (socketPath: string) => path.join(path.dirname(socketPath), "status.json");

export async function writeUploadServiceStatus(socketPath: string, reason: UploadServiceDownReason): Promise<void> {
  const target = uploadServiceStatusPath(socketPath);
  const staged = `${target}.${randomBytes(4).toString("hex")}`;
  await writeFile(staged, `${JSON.stringify({ version: 1, reason, at: new Date().toISOString() })}\n`, { mode: 0o600, flag: "wx" });
  await rename(staged, target);
}

export async function clearUploadServiceStatus(socketPath: string): Promise<void> {
  await unlink(uploadServiceStatusPath(socketPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/** The reason the service left, or null: a missing, foreign, shared or malformed file says nothing */
export async function readUploadServiceStatus(socketPath: string): Promise<UploadServiceDownReason | null> {
  try {
    const at = uploadServiceStatusPath(socketPath);
    const info = await lstat(at);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.() || info.size > 1024) return null;
    return statusSchema.parse(JSON.parse(await readFile(at, "utf8"))).reason;
  } catch {
    return null;
  }
}
