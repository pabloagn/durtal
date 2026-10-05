import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireApiToken } from "@/lib/api/rest";
import { InterchangeFileError } from "@/lib/interchange/format";
import { CONFLICT_POLICIES, importInterchange } from "@/lib/interchange/import";

/** The largest file an import reads */
const MAX_BYTES = 50 * 1024 * 1024;

const bodySchema = z.strictObject({
  /** What to do with a work that is already here and differs: keep, add or fail. No default */
  policy: z.enum(CONFLICT_POLICIES),
  /** Check everything and write nothing; a run writes only when this is false */
  dryRun: z.boolean().default(true),
  document: z.unknown(),
});

/**
 * POST /api/interchange/import (SLN-375)
 *
 * Imports a Durtal interchange file. Needs the API token. Each record is one
 * transaction: a record that fails writes nothing and the others still
 * import. Rows that are here already are never changed. The answer reports
 * each record: created, unchanged, added, kept or failed, with the reasons.
 * A file of another format or version is refused whole.
 */
export async function POST(req: NextRequest) {
  const denied = requireApiToken(req);
  if (denied) return denied;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES)
      return NextResponse.json({ error: "The file is over 50 MB. Export fewer records at a time." }, { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "The body is not JSON." }, { status: 400 });
    }
    const body = bodySchema.parse(json);
    const report = await importInterchange(body.document, { policy: body.policy, dryRun: body.dryRun });
    return NextResponse.json(report, { status: 200 });
  } catch (err) {
    if (err instanceof InterchangeFileError)
      return NextResponse.json({ error: err.message, issues: err.issues.slice(0, 200) }, { status: 400 });
    return errorResponse(err, "Import failed");
  }
}
