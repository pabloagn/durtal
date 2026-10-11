import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

/** Real byte buffers; only the catalogue storage boundary is fake. Unexpected
 * commands fail rather than reaching AWS. Ebook source storage stays separate. */
export const coverBucket = {
  objects: new Map<string, Buffer>(), calls: [] as unknown[],
  failBefore: new Set<string>(), failAfter: new Set<string>(), corruptReads: new Set<string>(),
};
export function resetCoverBucket() {
  coverBucket.objects.clear(); coverBucket.calls.length = 0;
  coverBucket.failBefore.clear(); coverBucket.failAfter.clear(); coverBucket.corruptReads.clear();
}
export async function catalogueSend(command: unknown) {
  coverBucket.calls.push(command);
  if (command instanceof PutObjectCommand) {
    const { Key, Body, IfNoneMatch, ChecksumSHA256 } = command.input;
    if (!Key || IfNoneMatch !== "*") throw new Error("Unconditional catalogue cover PUT forbidden");
    const bytes = Buffer.from(Body as Uint8Array);
    if (ChecksumSHA256 !== createHash("sha256").update(bytes).digest("base64")) throw new Error("Missing output checksum");
    if (coverBucket.failBefore.has(Key)) throw new Error("PUT refused");
    if (coverBucket.objects.has(Key)) throw Object.assign(new Error("Already exists"), { name: "PreconditionFailed" });
    coverBucket.objects.set(Key, Buffer.from(bytes));
    if (coverBucket.failAfter.has(Key)) throw new Error("PUT acknowledgement lost");
    return {};
  }
  if (command instanceof GetObjectCommand) {
    const key = command.input.Key!;
    let bytes = coverBucket.objects.get(key);
    if (!bytes) throw new Error("NoSuchKey");
    if (coverBucket.corruptReads.has(key)) bytes = Buffer.alloc(bytes.length);
    const copy = Buffer.from(bytes);
    return { ContentLength: copy.length, ContentType: "image/webp", Body: {
      transformToWebStream: () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(copy); c.close(); } }),
      transformToByteArray: async () => new Uint8Array(copy),
    } };
  }
  if (command instanceof ListObjectsV2Command)
    return { Contents: [...coverBucket.objects.keys()].filter(k => k.startsWith(command.input.Prefix ?? "")).map(Key => ({ Key })), IsTruncated: false };
  if (command instanceof DeleteObjectsCommand) {
    for (const { Key } of command.input.Delete?.Objects ?? []) coverBucket.objects.delete(Key!);
    return { Errors: [] };
  }
  if (command instanceof DeleteObjectCommand) { coverBucket.objects.delete(command.input.Key!); return {}; }
  throw new Error("Unexpected catalogue storage command");
}
export async function realCoverBytes(background = "#224466") {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 40, height: 60, channels: 3, background } }).png().toBuffer();
}
export async function mintCover(editionId: string, url = "https://example.com/cover.jpg", background?: string) {
  const { allocateCoverStage, renderCoverPair, stageCoverPair } = await import("@/lib/s3/cover-stage");
  const allocation = allocateCoverStage({ editionId, source: { kind: "url", url } });
  const { buffers, palette } = await renderCoverPair(await realCoverBytes(background));
  return stageCoverPair(allocation, buffers, palette);
}
