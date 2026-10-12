import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { isUuid } from "@/lib/utils/uuid";
import { appTimeZone } from "@/lib/utils/date";
import { parseReaderSessionJson, MAX_READER_SESSION_BYTES } from "@/lib/validations/reader-tracking";
import { ReaderTrackingConflict, saveReaderSitting } from "@/lib/reading/reader-session-service";

export const dynamic = "force-dynamic";
const json = (status: number, value: unknown) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });

/** Enforce the byte limit while streaming, including requests without Content-Length. */
async function body(req: Request) {
  if (!req.body) throw new Error("Missing sitting");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_READER_SESSION_BYTES) { await reader.cancel(); throw new Error("Sitting request is too large"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ebookId: string }> }) {
  const refused = crossOriginRefusal(req);
  if (refused) return refused;
  const { ebookId } = await params;
  if (!isUuid(ebookId)) return json(400, { error: "Invalid eBook id" });
  const deviceId = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(deviceId)) return json(400, { error: "Open the reader to identify this device" });
  const expectedDevice = req.nextUrl.searchParams.get("device");
  if (expectedDevice !== null && expectedDevice !== deviceId) return json(409, { error: "The reader device changed. Reopen the reader before syncing." });
  let input;
  try { input = parseReaderSessionJson(await body(req), new Date(), appTimeZone()); }
  catch { return json(400, { error: "Invalid reader sitting" }); }
  try {
    // Permanent receipts are checked before looking up a potentially deleted binding.
    return json(200, await saveReaderSitting(input, { ebookId: ebookId.toLowerCase(), deviceId }));
  } catch (error) {
    if (error instanceof ReaderTrackingConflict) return json(error.status, { error: error.message });
    console.error("[reader/session] Save failed", error);
    return json(503, { error: "Reading could not be saved. Your sitting remains pending." });
  }
}
