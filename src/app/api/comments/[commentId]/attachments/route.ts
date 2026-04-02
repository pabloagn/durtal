import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comments, commentAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { uploadToS3 } from "@/lib/s3";
import { goldCommentAttachmentKey } from "@/lib/s3/keys";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const { commentId } = await params;

  // Verify comment exists
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, commentId),
    columns: { id: true, entityType: true, entityId: true },
  });
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  // Check attachment count
  const existingAttachments = await db.query.commentAttachments.findMany({
    where: eq(commentAttachments.commentId, commentId),
    columns: { id: true },
  });
  if (existingAttachments.length >= 10) {
    return NextResponse.json({ error: "Maximum 10 attachments per comment" }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // 25MB limit
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (25MB max)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() ?? "bin";
  const fileId = randomUUID();
  const s3Key = goldCommentAttachmentKey(
    comment.entityType,
    comment.entityId,
    commentId,
    fileId,
    ext,
  );

  await uploadToS3(s3Key, buffer, file.type);

  const isImage = file.type.startsWith("image/");

  const [attachment] = await db
    .insert(commentAttachments)
    .values({
      commentId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      s3Key,
      isImage,
    })
    .returning();

  return NextResponse.json(attachment, { status: 201 });
}
