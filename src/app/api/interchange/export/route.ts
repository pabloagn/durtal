import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, readJson } from "@/lib/api/rest";
import { WORK_KINDS } from "@/lib/catalogue/kinds";
import { exportInterchange } from "@/lib/interchange/export";
import { todayLocal } from "@/lib/utils/date";

const bodySchema = z
  .strictObject({
    /** These collections only; every open collection when absent */
    domains: z.array(z.enum(WORK_KINDS)).min(1).optional(),
    /** These works only */
    ids: z.array(z.uuid()).min(1).max(5000).optional(),
  })
  .default({});

/**
 * POST /api/interchange/export (SLN-375)
 *
 * The Durtal interchange file (version 1) of the chosen works, or of every
 * work of the open collections: each record with its credits, editions or
 * formulations or versions or objects, copies, sources, classification,
 * collection places, links and location history, and the people,
 * organizations, venues and vocabularies they point at. Reads only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await readJson(req)) ?? {};
    const selection = bodySchema.parse(body);
    const document = await exportInterchange(selection);
    if (!document.records.length) return NextResponse.json({ error: "No records to export." }, { status: 404 });
    return new NextResponse(JSON.stringify(document), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="durtal-interchange-${todayLocal()}.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err, "Export failed");
  }
}
