import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

/*
 * SLN-491: before the AWS setup there is no e-book bucket. Settings says the
 * storage is not set up yet rather than broken, and the orphan report still
 * prints, naming the bucket as missing.
 */

const mocks = vi.hoisted(() => ({ newest: null as Record<string, unknown> | null }));
vi.mock("@/lib/ebooks/delivery/files", async (original) => ({
  ...(await original<typeof import("@/lib/ebooks/delivery/files")>()),
  readNewestDeliverableFile: vi.fn(async () => mocks.newest),
}));
vi.mock("@/lib/s3/client", () => ({ s3: {}, S3_BUCKET: "test-bucket" }));

import { runIntegrationCheck } from "@/lib/settings/integrations";
import { ebookOrphanReport } from "@/lib/ebooks/verify";
import type { Db } from "@/lib/catalogue/work-store";

const sha = "ab".repeat(32);
const notFound = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
let send: ReturnType<typeof vi.spyOn>;
let bucketExists: boolean;

beforeEach(() => {
  mocks.newest = null;
  bucketExists = false;
  send = vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: unknown) => {
    if (!bucketExists) throw notFound(command instanceof HeadBucketCommand ? "NotFound" : "NoSuchBucket");
    if (command instanceof HeadBucketCommand) return {};
    if (command instanceof ListObjectsV2Command)
      return command.input.Prefix === "files/"
        ? { Contents: [{ Key: `files/ab/${sha}.epub`, Size: 10, LastModified: new Date(Date.now() - 3 * 86_400_000) }], IsTruncated: false }
        : { Contents: [], IsTruncated: false };
    if (command instanceof HeadObjectCommand) throw notFound("NotFound");
    throw new Error("Unexpected S3 command");
  }) as never);
});
afterEach(() => send.mockRestore());

/** A catalogue with no file rows: what ebookOrphans reads */
const emptyCatalogue = { select: () => ({ from: async () => [] }) } as unknown as Db;

describe("Settings › Integrations › eBook storage before the AWS setup", () => {
  it("is not set up yet, not broken, when there is neither a bucket nor a file", async () => {
    expect(await runIntegrationCheck("ebookStorage")).toEqual({
      status: "off",
      message: "Not set up yet: no eBook bucket and no eBook file (scripts/aws/ebooks-storage.sh plan)",
    });
  });

  it("works once the bucket exists, with no file yet", async () => {
    bucketExists = true;
    expect(await runIntegrationCheck("ebookStorage")).toMatchObject({ status: "ok", message: expect.stringContaining("no eBook file is stored yet") });
  });

  it("fails when a file is catalogued but the bucket is gone", async () => {
    mocks.newest = { id: "f", ebookId: "e", sha256: sha, s3Key: `files/ab/${sha}.epub`, format: "epub", sizeBytes: 10, contentType: "application/epub+zip", status: "stored", drm: null };
    expect((await runIntegrationCheck("ebookStorage")).status).toBe("error");
  });
});

describe("the orphan report's e-book part", () => {
  it("names the bucket as missing before the AWS setup", async () => {
    expect(await ebookOrphanReport(emptyCatalogue)).toEqual({ bucket: "durtal-ebooks", missing: true });
  });

  it("lists the objects no row names once the bucket exists", async () => {
    bucketExists = true;
    const report = await ebookOrphanReport(emptyCatalogue);
    expect(report).toMatchObject({ bucket: "durtal-ebooks", prefixes: ["files/", "derived/"], scanned: 1, orphans: 1, inFlight: 0, totalBytes: 10 });
    expect(report).not.toHaveProperty("missing");
  });

  it("still fails on any other S3 error", async () => {
    send.mockImplementation((async () => {
      throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    }) as never);
    await expect(ebookOrphanReport(emptyCatalogue)).rejects.toThrow("AccessDenied");
  });
});
