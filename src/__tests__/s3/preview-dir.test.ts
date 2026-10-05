import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn(async () => ({ Body: "s3-body", ContentType: "text/csv", ContentLength: 7 })));
vi.mock("@/lib/s3/client", () => ({ s3: { send }, S3_BUCKET: "local-test" }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));
import { deleteFromS3, getS3Object, uploadToS3 } from "@/lib/s3/covers";

/* The disposable preview's S3 folder (SLN-450): with DURTAL_PREVIEW_S3_DIR
   the three helpers use files; without it, the S3 client. */

const root = join(__dirname, "../../..");

afterEach(() => {
  delete process.env.DURTAL_PREVIEW_S3_DIR;
  send.mockClear();
});

describe("the preview's S3 folder", () => {
  it("writes, reads and deletes files under the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "durtal-s3-"));
    try {
      process.env.DURTAL_PREVIEW_S3_DIR = dir;
      expect(await uploadToS3("bronze/imports/abc/export.csv", new TextEncoder().encode("Title\nWatt\n"), "text/csv")).toBe("bronze/imports/abc/export.csv");
      expect(readFileSync(join(dir, "bronze/imports/abc/export.csv"), "utf8")).toBe("Title\nWatt\n");
      const object = await getS3Object("bronze/imports/abc/export.csv");
      expect([object.contentType, object.contentLength]).toEqual(["text/csv", 11]);
      expect(new TextDecoder().decode(await object.body!.transformToByteArray())).toBe("Title\nWatt\n");
      const stream = object.body!.transformToWebStream();
      expect(new TextDecoder().decode((await stream.getReader().read()).value)).toBe("Title\nWatt\n");
      await deleteFromS3("bronze/imports/abc/export.csv");
      await expect(getS3Object("bronze/imports/abc/export.csv")).rejects.toMatchObject({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      expect(send).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a key that leaves the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "durtal-s3-"));
    try {
      process.env.DURTAL_PREVIEW_S3_DIR = dir;
      for (const key of ["../outside.csv", "a/../../outside.csv", "/etc/passwd"])
        await expect(uploadToS3(key, new Uint8Array([1]), "text/csv")).rejects.toThrow(/leaves the preview folder/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the S3 client without the variable", async () => {
    await uploadToS3("bronze/imports/abc/export.csv", new Uint8Array([1]), "text/csv");
    await getS3Object("bronze/imports/abc/export.csv");
    await deleteFromS3("bronze/imports/abc/export.csv");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("is never set by the image, compose or the example environment", () => {
    for (const file of ["Dockerfile", "docker-compose.yml", ".env.example"])
      expect(readFileSync(join(root, file), "utf8"), file).not.toContain("DURTAL_PREVIEW_S3_DIR");
  });
});
