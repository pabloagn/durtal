import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { comments, activityEvents } from "@/lib/db/schema";
import { deleteUnusedObjects, keysOf, ownedPrefixes } from "@/lib/s3/cleanup";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { updateCommentSchema } from "@/lib/validations/comments";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";
import { isUuid } from "@/lib/utils/uuid";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const { commentId } = await params;
  if (!isUuid(commentId)) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }
  let parsed;
  try {
    const body = await req.json();
    parsed = updateCommentSchema.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
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
  if (!isUuid(commentId)) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }

  // Read the file keys first: the cascade removes the attachment rows.
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    columns: { id: true, entityType: true, entityId: true },
    with: { attachments: { columns: { s3Key: true } } },
  });
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  // The comment and its timeline event go together (JSONB match for the event)
  const results = await atomic((d) => [
    d
      .delete(activityEvents)
      .where(
        and(
          eq(activityEvents.entityType, comment.entityType),
          eq(activityEvents.entityId, comment.entityId),
          sql`${activityEvents.metadata}->>'commentId' = ${commentId}`,
        ),
      ),
    d
      .delete(comments)
      .where(eq(comments.id, commentId))
      .returning({ id: comments.id }),
  ]);
  if ((results[1] as { id: string }[]).length === 0) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  await deleteUnusedObjects(
    {
      keys: keysOf(comment.attachments),
      prefixes: ownedPrefixes.comment(comment),
    },
    `comment ${commentId}`,
  );

  return NextResponse.json({ success: true });
}
