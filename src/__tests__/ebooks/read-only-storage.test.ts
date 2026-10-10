import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { initializeEbookCli } from "@/lib/ebooks/storage";
import { withReadOnlyEbookStorage } from "@/lib/ebooks/read-only-storage";
import {
  verificationHasExceptions,
  type VerifyReport,
} from "@/lib/ebooks/verify";

afterEach(() => {
  delete (globalThis as unknown as { ebookCli?: unknown }).ebookCli;
});

function localSdk() {
  const handle = vi.fn(async () => ({
    response: {
      statusCode: 200,
      headers: { "content-length": "0" },
      body: Readable.from([]),
    },
  }));
  const client = new S3Client({
    region: "eu-north-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: { handle },
  });
  initializeEbookCli(client, "test", "608240934043");
  return { client, handle };
}

describe("actual SDK dispatch during read-only eBook operations", () => {
  it("allows reads and rejects mutations before the request handler", async () => {
    const { client, handle } = localSdk();
    await withReadOnlyEbookStorage(async () => {
      await client.send(
        new HeadObjectCommand({ Bucket: "test", Key: "gold/ebooks/test" }),
      );
      await client.send(
        new GetObjectCommand({ Bucket: "test", Key: "gold/ebooks/test" }),
      );
      await client.send(new ListObjectsV2Command({ Bucket: "test" }));
      expect(handle).toHaveBeenCalledTimes(3);
      await expect(
        client.send(
          new PutObjectCommand({ Bucket: "test", Key: "test", Body: "bad" }),
        ),
      ).rejects.toThrow(
        "Read-only eBook planning refused AWS PutObjectCommand",
      );
      await expect(
        client.send(new DeleteObjectCommand({ Bucket: "test", Key: "test" })),
      ).rejects.toThrow("nothing sent");
      expect(handle).toHaveBeenCalledTimes(3);
    });
    client.destroy();
  });

  it("keeps nested scopes protected and restores apply dispatch after failure", async () => {
    const { client, handle } = localSdk();
    await expect(
      withReadOnlyEbookStorage(async () => {
        await withReadOnlyEbookStorage(async () => {
          await client.send(
            new HeadObjectCommand({ Bucket: "test", Key: "test" }),
          );
        });
        await client.send(
          new PutObjectCommand({ Bucket: "test", Key: "test", Body: "bad" }),
        );
      }),
    ).rejects.toThrow("nothing sent");
    expect(handle).toHaveBeenCalledOnce();
    await client.send(
      new PutObjectCommand({
        Bucket: "test",
        Key: "test",
        Body: "allowed outside plan",
      }),
    );
    expect(handle).toHaveBeenCalledTimes(2);
    client.destroy();
  });
});

it("verification failures affect CLI status, while in-flight objects do not", () => {
  const report = {
    rows: [],
    unreferenced: [],
    inFlight: [{ key: "young" }],
  } as unknown as VerifyReport;
  expect(verificationHasExceptions(report)).toBe(false);
  expect(
    verificationHasExceptions({
      ...report,
      rows: [{ outcome: "missing-object" }] as VerifyReport["rows"],
    }),
  ).toBe(true);
  expect(
    verificationHasExceptions({ ...report, unreferenced: report.inFlight }),
  ).toBe(true);
});
