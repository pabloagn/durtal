"use server";

import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import { comments } from "@/lib/db/schema";
import { eq, and, desc, lt, inArray } from "drizzle-orm";

export interface TimelineItem {
  id: string;
  entityType: string;
  entityId: string;
  eventKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  // Populated for comment events
  comment?: {
    id: string;
    contentHtml: string;
    contentJson: unknown;
    updatedAt: Date;
    attachments: {
      id: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      s3Key: string;
      isImage: boolean;
      thumbnailUrl: string | null;
    }[];
  } | null;
}

export async function getActivityTimeline(
  entityType: "work" | "author",
  entityId: string,
  limit = 20,
  cursor?: string,
): Promise<{ events: TimelineItem[]; hasMore: boolean }> {
  const conditions = [
    eq(activityEvents.entityType, entityType),
    eq(activityEvents.entityId, entityId),
  ];

  if (cursor) {
    conditions.push(lt(activityEvents.createdAt, new Date(cursor)));
  }

  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(...conditions))
    .orderBy(desc(activityEvents.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit);

  // Collect comment IDs for comment events
  const commentIds = events
    .filter((e) => e.eventKey.endsWith(".comment_added"))
    .map((e) => {
      const meta = e.metadata as Record<string, unknown> | null;
      return meta?.commentId as string | undefined;
    })
    .filter((id): id is string => !!id);

  // Batch-fetch comments and their attachments
  let commentMap = new Map<
    string,
    TimelineItem["comment"]
  >();

  if (commentIds.length > 0) {
    const commentRows = await db.query.comments.findMany({
      where: inArray(comments.id, commentIds),
      with: { attachments: true },
    });

    for (const c of commentRows) {
      commentMap.set(c.id, {
        id: c.id,
        contentHtml: c.contentHtml,
        contentJson: c.contentJson,
        updatedAt: c.updatedAt,
        attachments: c.attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          fileSize: a.fileSize,
          mimeType: a.mimeType,
          s3Key: a.s3Key,
          isImage: a.isImage,
          thumbnailUrl: a.thumbnailUrl,
        })),
      });
    }
  }

  const timeline: TimelineItem[] = events.map((e) => {
    const meta = e.metadata as Record<string, unknown> | null;
    const commentId = meta?.commentId as string | undefined;
    return {
      id: e.id,
      entityType: e.entityType,
      entityId: e.entityId,
      eventKey: e.eventKey,
      metadata: meta,
      createdAt: e.createdAt,
      comment: commentId ? commentMap.get(commentId) ?? null : undefined,
    };
  });

  return { events: timeline, hasMore };
}
