import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { errorResponse } from "@/lib/api/rest";
import { UnknownFormatError } from "@/lib/reading/import/formats";
import { createReadingImport, safeFileName, setBronzeKey } from "@/lib/reading/import/store";
import { bronzeImportKey } from "@/lib/s3/keys";
import { uploadToS3 } from "@/lib/s3/covers";
import { MAX_IMPORT_BYTES } from "@/lib/validations/reading-import";

/**
 * POST /api/reading/import (SLN-450)
 *
 * One reading history file as multipart `file`: a Goodreads, StoryGraph or
 * Durtal CSV of at most 10 MB. Parses, matches and stores the import and its
 * rows in one write, then keeps the raw file in S3 when it can. Answers
 * `{ importId }`; the preview is `/reading/import/<importId>`. A route, not a
 * server action: a full Goodreads export passes the action body limit.
 */
export async function POST(req: NextRequest) {
  const refused = crossOriginRefusal(req);
  if (refused) return refused;
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "The file did not arrive intact. Please choose it again." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV file to import" }, { status: 400 });
    if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "This file is over 10 MB. Export a smaller one." }, { status: 400 });
    const isCsv = /\.csv$/i.test(file.name) && (!file.type || ["text/csv", "application/vnd.ms-excel", "text/plain", "application/csv"].includes(file.type));
    if (!isCsv) return NextResponse.json({ error: "Only CSV files can be imported: a Goodreads, StoryGraph or Durtal export" }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(bytes);

    let created: Awaited<ReturnType<typeof createReadingImport>>;
    try {
      created = await createReadingImport({ text, fileName: file.name });
    } catch (err) {
      if (err instanceof UnknownFormatError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    // Best effort: the import's state lives in Postgres, the raw file is a copy
    try {
      const key = bronzeImportKey(created.importId, safeFileName(file.name));
      await uploadToS3(key, bytes, "text/csv");
      await setBronzeKey(created.importId, key);
    } catch (err) {
      console.warn("[reading/import] The raw file was not kept", { importId: created.importId, error: err instanceof Error ? err.message : String(err) });
    }
    return NextResponse.json({ importId: created.importId, source: created.source, rows: created.rows }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to import the file");
  }
}
