import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comments, commentAttachments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { uploadToS3 } from "@/lib/s3";
import { goldCommentAttachmentKey } from "@/lib/s3/keys";
import { randomUUID } from "crypto";
import { ATTACHMENT_EXTENSIONS, attachmentType } from "@/lib/s3/attachment-types";
import { isUuid } from "@/lib/utils/uuid";

/** The name shown for a file: no folders, no control characters, at most 255 characters */
function displayName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const printable = [...base].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127);
  return printable.join("").trim().slice(0, 255);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ commentId: string }> },
) {
  const { commentId } = await params;
  if (!isUuid(commentId)) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }

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

  // The type comes from the checked extension, not from the browser
  const fileName = displayName(file.name);
  const type = attachmentType(fileName);
  if (!type) {
    return NextResponse.json(
      {
        error: `This kind of file cannot be attached. Accepted: ${ATTACHMENT_EXTENSIONS.join(", ")}.`,
      },
      { status: 400 },
    );
  }
  const { ext, mimeType } = type;

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileId = randomUUID();
  const s3Key = goldCommentAttachmentKey(
    comment.entityType,
    comment.entityId,
    commentId,
    fileId,
    ext,
  );

  await uploadToS3(s3Key, buffer, mimeType);

  const isImage = mimeType.startsWith("image/");

  const [attachment] = await db
    .insert(commentAttachments)
    .values({
      commentId,
      fileName,
      fileSize: file.size,
      mimeType,
      s3Key,
      isImage,
    })
    .returning();

  return NextResponse.json(attachment, { status: 201 });
}
