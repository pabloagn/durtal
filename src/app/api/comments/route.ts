import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comments } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { createCommentSchema } from "@/lib/validations/comments";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";
import { recordActivity } from "@/lib/activity/record";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createCommentSchema.parse(body);
  const html = sanitizeCommentHtml(parsed.contentHtml);

  const [comment] = await db
    .insert(comments)
    .values({
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      contentHtml: html,
      contentJson: parsed.contentJson ?? null,
    })
    .returning();

  // Record activity event with commentId in metadata
  recordActivity(
    parsed.entityType as "work" | "author",
    parsed.entityId,
    `${parsed.entityType}.comment_added`,
    { commentId: comment.id },
  );

  return NextResponse.json(comment, { status: 201 });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "Missing entityType or entityId" }, { status: 400 });
  }

  const rows = await db.query.comments.findMany({
    where: and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)),
    with: { attachments: true },
    orderBy: desc(comments.createdAt),
  });

  return NextResponse.json(rows);
}
