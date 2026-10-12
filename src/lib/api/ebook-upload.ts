import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { crossOriginRefusal } from "./same-origin";
import { requireApiToken } from "./rest";
import { uploadBroker } from "@/lib/ebooks/upload/broker";
import { isUploadError, UploadError } from "@/lib/ebooks/upload/protocol";
import { isUploadAdmissionRefusal } from "@/lib/ebooks/upload/admission-refusal";

const MAX_JSON = 64 * 1024;
export const uploadJson = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
/** Same private app/proxy trust as reader routes. Nonbrowser callers use the
 * existing REST token. Access precedes payload reads and permanent-key replay.
 */
export function uploadAccess(req: NextRequest): { channel: "ui" | "api" } | NextResponse {
  const denied = crossOriginRefusal(req); if (denied) return denied;
  const site = req.headers.get("sec-fetch-site"); const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return uploadJson(403, { error: "Refused: the request comes from another origin." });
  const browser = site === "same-origin" || origin === req.nextUrl.origin;
  if (!browser || req.headers.has("authorization")) {
    const refused = requireApiToken(req); if (refused) return refused;
    return { channel: "api" };
  }
  return { channel: "ui" };
}
export async function boundedUploadJson(req: NextRequest): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) throw new UploadError(400, "invalid_input", "Send a JSON request.");
  const declared = req.headers.get("content-length");
  if (declared && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > MAX_JSON)) throw new UploadError(413, "request_too_large", "Upload metadata exceeds 64 KiB.");
  if (!req.body) throw new UploadError(400, "invalid_input", "Upload metadata is missing.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0; let done = false;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) { done = true; break; }
      bytes += next.value.byteLength;
      if (bytes > MAX_JSON) throw new UploadError(413, "request_too_large", "Upload metadata exceeds 64 KiB.");
      chunks.push(next.value);
    }
    if (declared && Number(declared) !== bytes) throw new UploadError(400, "invalid_input", "Upload metadata length differs.");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
    catch { throw new UploadError(400, "invalid_input", "Upload metadata is not valid JSON."); }
  } finally { if (!done) await reader.cancel(); reader.releaseLock(); }
}
export function uploadErrorResponse(error: unknown): NextResponse {
  if (isUploadAdmissionRefusal(error)) return uploadJson(error.status, { code: error.code, error: error.message, refusal: error.refusal });
  if (isUploadError(error)) return uploadJson(error.status, { code: error.code, error: error.message });
  if (error instanceof z.ZodError || (error instanceof Error && error.name === "ZodError")) return uploadJson(400, { code: "invalid_input", error: "The upload request is invalid." });
  return uploadJson(503, { code: "outcome_unknown_retry_original", error: "The upload response is uncertain. Refresh or retry the same request." });
}
export async function handleUploadCreate(req: NextRequest) {
  const access = uploadAccess(req); if (access instanceof NextResponse) return access;
  try { return uploadJson(201, await uploadBroker().create(await boundedUploadJson(req), access.channel)); }
  catch (error) { return uploadErrorResponse(error); }
}
export async function handleUploadBatch(req: NextRequest, batchId: string) {
  const access = uploadAccess(req); if (access instanceof NextResponse) return access;
  try {
    z.uuid().parse(batchId); const broker = uploadBroker();
    return uploadJson(200, { batch: await broker.batch(batchId, access.channel), ready: await broker.ready() });
  } catch (error) { return uploadErrorResponse(error); }
}
export async function handleUploadCommand(req: NextRequest, operationId: string) {
  const access = uploadAccess(req); if (access instanceof NextResponse) return access;
  try {
    z.uuid().parse(operationId); const outcome = await uploadBroker().command(operationId, await boundedUploadJson(req), access.channel);
    return uploadJson(outcome.status, outcome);
  } catch (error) { return uploadErrorResponse(error); }
}
export async function handleUploadItem(req: NextRequest, operationId: string) {
  const access = uploadAccess(req); if (access instanceof NextResponse) return access;
  try { z.uuid().parse(operationId); return uploadJson(200, await uploadBroker().item(operationId, access.channel)); }
  catch (error) { return uploadErrorResponse(error); }
}
export async function handleUploadPart(req: NextRequest, operationId: string, part: string) {
  const access = uploadAccess(req); if (access instanceof NextResponse) return access;
  try {
    z.uuid().parse(operationId);
    if (!/^[1-9][0-9]{0,2}$/.test(part)) throw new UploadError(400, "invalid_part", "Invalid part number.");
    const generation = req.headers.get("x-upload-generation"); const sha256 = req.headers.get("x-upload-sha256") ?? "";
    if (!generation || !/^(0|[1-9][0-9]*)$/.test(generation)) throw new UploadError(400, "invalid_input", "Upload generation is missing.");
    z.string().regex(/^[a-f0-9]{64}$/).parse(sha256);
    z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(Number(generation)); z.number().int().min(1).max(512).parse(Number(part));
    const declared = req.headers.get("content-length");
    if (declared && (!/^[1-9][0-9]*$/.test(declared) || Number(declared) > 8 * 1024 * 1024))
      throw new UploadError(413, "part_too_large", "Each upload part is at most 8 MiB.");
    if (req.headers.get("content-type") !== "application/octet-stream" || !req.body)
      throw new UploadError(400, "invalid_part", "Send this part as an unencoded byte stream.");
    if (req.headers.has("content-encoding")) throw new UploadError(400, "invalid_part", "Encoded upload parts are not supported.");
    return uploadJson(200, await uploadBroker().part({ id: operationId, number: Number(part), generation: Number(generation), sha256, body: req.body }));
  } catch (error) { return uploadErrorResponse(error); }
}
