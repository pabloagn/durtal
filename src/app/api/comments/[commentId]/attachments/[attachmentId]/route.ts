import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentAttachments } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteUnusedObjects } from "@/lib/s3/cleanup";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string; attachmentId: string }> },
) {
  const { commentId, attachmentId } = await params;

  // Only an attachment of the comment in the URL
  const [deleted] = await db
    .delete(commentAttachments)
    .where(
      and(
        eq(commentAttachments.id, attachmentId),
        eq(commentAttachments.commentId, commentId),
      ),
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  await deleteUnusedObjects(
    { keys: [deleted.s3Key], prefixes: [] },
    `comment attachment ${attachmentId}`,
  );

  return NextResponse.json({ success: true });
}
