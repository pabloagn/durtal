import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { commentAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { deleteFromS3 } from "@/lib/s3";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ commentId: string; attachmentId: string }> },
) {
  const { attachmentId } = await params;

  const [deleted] = await db
    .delete(commentAttachments)
    .where(eq(commentAttachments.id, attachmentId))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Delete from S3
  await deleteFromS3(deleted.s3Key).catch(() => {});

  return NextResponse.json({ success: true });
}
