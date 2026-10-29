import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { errorResponse } from "@/lib/api/rest";
import { DELIMITED_IMPORT_MESSAGE, delimitedUploadFormat, ImportFileError } from "@/lib/reading/import/formats";
import { emptyDurtalExport } from "@/lib/reading/import/parse";
import { detectDelimiter } from "@/lib/reading/import/csv";
import { createReadingImport, safeFileName, setBronzeKey } from "@/lib/reading/import/store";
import { bronzeImportKey } from "@/lib/s3/keys";
import { uploadToS3 } from "@/lib/s3/covers";
import { MAX_IMPORT_BYTES } from "@/lib/validations/reading-import";

/**
 * POST /api/reading/import (SLN-450)
 *
 * One reading history file as multipart `file`: a Goodreads, StoryGraph or
 * Durtal reading CSV/TSV of at most 10 MB. Parses, matches and stores the import and its
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
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV or TSV file to import" }, { status: 400 });
    if (file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "This file is over 10 MB. Export a smaller one." }, { status: 400 });
    if (!delimitedUploadFormat(file.name, file.type)) return NextResponse.json({ error: DELIMITED_IMPORT_MESSAGE }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder("utf-8").decode(bytes);

    try {
      const entity = emptyDurtalExport(text);
      if (entity) return NextResponse.json({ kind: "empty", entity, source: "durtal", rows: 0 }, { status: 200 });
    } catch (err) {
      if (err instanceof ImportFileError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    let created: Awaited<ReturnType<typeof createReadingImport>>;
    try {
      created = await createReadingImport({ text, fileName: file.name });
    } catch (err) {
      if (err instanceof ImportFileError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    // Best effort: the import's state lives in Postgres, the raw file is a copy
    try {
      const key = bronzeImportKey(created.importId, safeFileName(file.name));
      await uploadToS3(key, bytes, detectDelimiter(text) === "\t" ? "text/tab-separated-values" : "text/csv");
      await setBronzeKey(created.importId, key);
    } catch (err) {
      console.warn("[reading/import] The raw file was not kept", { importId: created.importId, error: err instanceof Error ? err.message : String(err) });
    }
    return NextResponse.json({ importId: created.importId, source: created.source, rows: created.rows }, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to import the file");
  }
}
