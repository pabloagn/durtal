import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comments, activityEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { updateCommentSchema } from "@/lib/validations/comments";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const { commentId } = await params;
  const body = await req.json();
  const parsed = updateCommentSchema.parse(body);
  const html = sanitizeCommentHtml(parsed.contentHtml);

  const [updated] = await db
    .update(comments)
    .set({
      contentHtml: html,
      contentJson: parsed.contentJson ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const { commentId } = await params;

  // Delete the comment (cascade deletes attachments)
  const [deleted] = await db
    .delete(comments)
    .where(eq(comments.id, commentId))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  // Also delete the corresponding activity event
  // Use raw SQL for JSONB match
  await db
    .delete(activityEvents)
    .where(
      and(
        eq(activityEvents.entityType, deleted.entityType),
        eq(activityEvents.entityId, deleted.entityId),
        sql`${activityEvents.metadata}->>'commentId' = ${commentId}`,
      ),
    );

  return NextResponse.json({ success: true });
}
