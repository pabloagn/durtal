import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ID = "6f1c2a4e-8b3d-4c5a-9e7f-0a1b2c3d4e5f";
const FILE_ID = "0e9d8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  upload: vi.fn(async () => {}),
  presign: vi.fn(async () => "https://s3.example/signed"),
  ingest: vi.fn(async () => ({ id: "media" })),
  ownerKind: vi.fn(async (): Promise<null> => null),
  fetchImage: vi.fn(async () => ({ buffer: Buffer.from("x") })),
  deleteMedia: vi.fn(async () => {}),
  inserted: [] as unknown[],
  comment: { id: "", entityType: "work", entityId: "" } as Record<string, string> | undefined,
}));

vi.mock("@/lib/db", () => {
  const insert = () => ({
    values: (values: unknown) => {
      mocks.inserted.push(values);
      return { returning: async () => [values] };
    },
  });
  return {
    db: {
      query: {
        comments: { findFirst: vi.fn(async () => mocks.comment), findMany: vi.fn(async () => []) },
        commentAttachments: { findMany: vi.fn(async () => []) },
        media: { findFirst: vi.fn(async () => undefined) },
      },
      insert,
    },
  };
});
vi.mock("@/lib/s3/client", () => ({ s3: { send: mocks.send }, S3_BUCKET: "local-test" }));
vi.mock("@/lib/s3", () => ({ uploadToS3: mocks.upload }));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: mocks.upload, getPresignedUploadUrl: mocks.presign }));
vi.mock("@/lib/media/ingest", async (original) => ({
  ...(await original<typeof import("@/lib/media/ingest")>()),
  ingestMedia: mocks.ingest,
  mediaOwnerKind: mocks.ownerKind,
}));
vi.mock("@/lib/net/safe-fetch", async (original) => ({
  ...(await original<typeof import("@/lib/net/safe-fetch")>()),
  safeFetchImage: mocks.fetchImage,
}));
vi.mock("@/lib/actions/media", () => ({ deleteMedia: mocks.deleteMedia }));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), cached: (fn: unknown) => fn, CACHE_TAGS: {} }));

import { isUuid } from "@/lib/utils/uuid";
import { isReadableKey } from "@/lib/s3/read-headers";
import { attachmentType } from "@/lib/s3/attachment-types";
import { MediaIngestError } from "@/lib/media/ingest";
import { GET as read } from "@/app/api/s3/read/route";
import { POST as upload } from "@/app/api/media/upload/route";
import { POST as fromUrl } from "@/app/api/media/from-url/route";
import { POST as processMedia } from "@/app/api/media/process/route";
import { GET as previewMonochrome } from "@/app/api/media/preview-monochrome/route";
import { DELETE as deleteMediaRoute } from "@/app/api/media/[id]/route";
import { GET as listComments } from "@/app/api/comments/route";
import { PATCH as editComment, DELETE as deleteComment } from "@/app/api/comments/[commentId]/route";
import { POST as attach } from "@/app/api/comments/[commentId]/attachments/route";
import { DELETE as detach } from "@/app/api/comments/[commentId]/attachments/[attachmentId]/route";
import { POST as reprocessAuthor } from "@/app/api/media/reprocess-author/route";
import { POST as exportRoute } from "@/app/api/export/route";

const get = (path: string) => new NextRequest(`http://local${path}`);
const post = (path: string, body: unknown) =>
  new NextRequest(`http://local${path}`, { method: "POST", body: JSON.stringify(body) });
const form = (path: string, fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return new NextRequest(`http://local${path}`, { method: "POST", body: data });
};
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "a.png", { type: "image/png" });
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  mocks.comment = { id: ID, entityType: "work", entityId: ID };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("broad endpoints", () => {
  it("has no presign route: nothing signs an arbitrary key", () => {
    expect(existsSync(join(process.cwd(), "src/app/api/s3/presign/route.ts"))).toBe(false);
  });

  it("reads only images, covers and comment attachments", () => {
    expect(isReadableKey("gold/media/work/x/poster/y.webp")).toBe(true);
    expect(isReadableKey("gold/covers/x/cover.webp")).toBe(true);
    expect(isReadableKey("gold/comments/work/x/c/f.pdf")).toBe(true);
    for (const key of ["bronze/media/work/x/y.jpg", "silver/covers/x/validated.jpg", "gold/exports/x/library_export.csv", "gold/media/../bronze/x", "gold/media//x", "other"])
      expect(isReadableKey(key)).toBe(false);
  });

  it("refuses any other key with 400 before asking S3", async () => {
    const res = await read(get("/api/s3/read?key=bronze/media/work/x/y.jpg"));
    expect(res.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("record ids", () => {
  it("knows a UUID", () => {
    expect(isUuid(ID)).toBe(true);
    for (const value of ["x", "", null, 7, `${ID}x`, ID.replaceAll("-", "")]) expect(isUuid(value)).toBe(false);
  });

  it("answers 400 for a malformed id and touches nothing", async () => {
    const responses = [
      await upload(form("/api/media/upload", { file: png(), entityType: "work", entityId: "x", mediaType: "poster" })),
      await fromUrl(post("/api/media/from-url", { entityType: "work", entityId: "x", mediaType: "poster", imageUrl: "https://example.com/a.jpg" })),
      await processMedia(post("/api/media/process", { action: "presign", entityType: "work", entityId: "x", filename: "a.jpg", contentType: "image/jpeg" })),
      await processMedia(post("/api/media/process", { action: "process", entityType: "work", entityId: ID, mediaType: "poster", fileId: "x", bronzeKey: "bronze/media/work/x/x.jpg" })),
      await previewMonochrome(get("/api/media/preview-monochrome?mediaId=x")),
      await deleteMediaRoute(get("/api/media/x"), params({ id: "x" })),
      await listComments(get(`/api/comments?entityType=work&entityId=x`)),
      await listComments(get(`/api/comments?entityType=book&entityId=${ID}`)),
      await editComment(post("/api/comments/x", { contentHtml: "<p>a</p>" }), params({ commentId: "x" })),
      await deleteComment(get("/api/comments/x"), params({ commentId: "x" })),
      await attach(form("/api/comments/x/attachments", { file: png() }), params({ commentId: "x" })),
      await detach(get("/api/comments/x/attachments/y"), params({ commentId: ID, attachmentId: "y" })),
      await reprocessAuthor(post("/api/media/reprocess-author", { mediaId: "x", processingParams: {} })),
      await exportRoute(post("/api/export", { entity: "works", ids: [ID, "x"], format: "csv" })),
    ];
    expect(responses.map((r) => r.status)).toEqual(Array(responses.length).fill(400));
    for (const call of [mocks.send, mocks.upload, mocks.presign, mocks.ingest, mocks.fetchImage, mocks.deleteMedia])
      expect(call).not.toHaveBeenCalled();
  });
});

describe("POST /api/media/process", () => {
  it("signs nothing for an owner that does not exist", async () => {
    mocks.ownerKind.mockRejectedValueOnce(new MediaIngestError("The image owner was not found", 404));
    const res = await processMedia(post("/api/media/process", { action: "presign", entityType: "work", entityId: ID, filename: "cover.exe", contentType: "image/jpeg" }));
    expect(res.status).toBe(404);
    expect(mocks.presign).not.toHaveBeenCalled();
  });

  it("takes the raw file's extension from its type, not its name", async () => {
    const res = await processMedia(post("/api/media/process", { action: "presign", entityType: "work", entityId: ID, filename: "cover.exe", contentType: "image/png" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.bronzeKey).toBe(`bronze/media/work/${ID}/${body.fileId}.png`);
  });

  it("reads no key but the one presign named for this image", async () => {
    for (const bronzeKey of ["gold/covers/x/cover.webp", `bronze/media/work/${ID}/${ID}.jpg`, `bronze/media/author/${ID}/${FILE_ID}.jpg`, `bronze/media/work/${ID}/${FILE_ID}.svg`]) {
      const res = await processMedia(post("/api/media/process", { action: "process", entityType: "work", entityId: ID, mediaType: "poster", fileId: FILE_ID, bronzeKey }));
      expect(res.status).toBe(400);
    }
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1]) } });
    const res = await processMedia(post("/api/media/process", { action: "process", entityType: "work", entityId: ID, mediaType: "poster", fileId: FILE_ID, bronzeKey: `bronze/media/work/${ID}/${FILE_ID}.jpg` }));
    expect(res.status).toBe(200);
    expect(mocks.ingest).toHaveBeenCalledOnce();
  });
});

describe("comment attachments", () => {
  it("allows documents and images by extension, and no programs", () => {
    expect(attachmentType("Scan.PDF")).toEqual({ ext: "pdf", mimeType: "application/pdf" });
    expect(attachmentType("photo.JPG")).toEqual({ ext: "jpg", mimeType: "image/jpeg" });
    for (const name of ["setup.exe", "run.sh", "x.bat", "tool.jar", "noextension", ".bashrc", "a.constructor", "a.toString"])
      expect(attachmentType(name)).toBeNull();
  });

  it("refuses a program and stores nothing", async () => {
    const file = new File(["#!/bin/sh"], "run.sh", { type: "text/plain" });
    const res = await attach(form(`/api/comments/${ID}/attachments`, { file }), params({ commentId: ID }));
    expect(res.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.inserted).toEqual([]);
  });

  it("stores the type of the extension, not the browser's, under a clean name", async () => {
    const file = new File(["%PDF"], "../../x/notes.PDF", { type: "text/html" });
    const res = await attach(form(`/api/comments/${ID}/attachments`, { file }), params({ commentId: ID }));
    expect(res.status).toBe(201);
    const [key, , contentType] = mocks.upload.mock.calls[0] as unknown as [string, Buffer, string];
    expect(key).toMatch(new RegExp(`^gold/comments/work/${ID}/${ID}/[0-9a-f-]{36}\\.pdf$`));
    expect(contentType).toBe("application/pdf");
    expect(mocks.inserted[0]).toMatchObject({ fileName: "notes.PDF", mimeType: "application/pdf", isImage: false });
  });
});
