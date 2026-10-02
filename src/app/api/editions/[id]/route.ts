import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { editions } from "@/lib/db/schema";
import { updateEdition } from "@/lib/actions/editions";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";

/** The fields an edition PATCH may change. Unknown fields are refused. */
const patchEditionSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    subtitle: z.string().trim().nullable().optional(),
  })
  .strict();

/**
 * PATCH /api/editions/[id] — rename an edition, as the Edit Edition dialog
 * does (activity log included). Other fields stay as they are.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const input = patchEditionSchema.parse(await readJson(req));
    const found = await db.query.editions.findFirst({
      where: eq(editions.id, id),
      columns: { id: true },
    });
    if (!found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await updateEdition(id, input);
    const edition = await db.query.editions.findFirst({
      where: eq(editions.id, id),
      columns: { id: true, title: true, subtitle: true, workId: true },
    });
    return NextResponse.json(edition);
  } catch (err) {
    return errorResponse(err, "Failed to update edition");
  }
}
