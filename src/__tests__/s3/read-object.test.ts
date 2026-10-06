import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/s3/client", () => ({ s3: { send }, S3_BUCKET: "local-test" }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));
import { uploadToS3 } from "@/lib/s3/covers";
import { bodyBytes, readS3Object } from "@/lib/s3/read-object";

/* The one whole-file read (SLN-300): S3, or the preview's folder */

afterEach(() => {
  delete process.env.DURTAL_PREVIEW_S3_DIR;
  send.mockReset();
});

describe("readS3Object", () => {
  it("reads a stored file from S3 as a buffer", async () => {
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } });
    expect(await readS3Object("gold/media/work/x/full.webp")).toEqual(Buffer.from([1, 2, 3]));
    expect(send).toHaveBeenCalledOnce();
  });

  it("reads from the preview's folder when there is one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "durtal-s3-"));
    try {
      process.env.DURTAL_PREVIEW_S3_DIR = dir;
      await uploadToS3("bronze/media/work/x/raw.png", new Uint8Array([9, 8]), "image/png");
      expect(await readS3Object("bronze/media/work/x/raw.png")).toEqual(Buffer.from([9, 8]));
      expect(send).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails with the key when the file has no body", async () => {
    send.mockResolvedValueOnce({ Body: undefined });
    await expect(readS3Object("gold/media/work/x/full.webp")).rejects.toThrow("The stored file is empty: gold/media/work/x/full.webp");
    await expect(bodyBytes(undefined, "a/b.png")).rejects.toThrow("a/b.png");
  });
});
