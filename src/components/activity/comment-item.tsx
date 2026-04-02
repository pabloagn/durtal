"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { CommentEditor } from "./comment-editor";
import { CommentAttachmentList } from "./comment-attachment-list";
import {
  formatRelativeTime,
  formatFullDate,
} from "@/lib/utils/relative-time";

interface CommentItemProps {
  eventId: string;
  comment: {
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
  };
  createdAt: Date;
  entityType: "work" | "author";
  entityId: string;
  onDeleted: (commentId: string) => void;
  onUpdated: () => void;
}

export function CommentItem({
  comment,
  createdAt,
  entityType,
  entityId,
  onDeleted,
  onUpdated,
}: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/comments/${comment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Failed to delete comment");
      }
      onDeleted(comment.id);
    } catch (error) {
      console.error("Error deleting comment:", error);
      setIsDeleting(false);
    }
  }

  return (
    <div className="relative -ml-[25px] mb-5">
      {/* Timeline dot */}
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-glass-border bg-bg-secondary">
        <MessageSquare className="h-3 w-3 text-fg-muted" />
      </div>

      {/* Comment card, offset to the right */}
      <div className="group ml-8 -mt-5 rounded-sm border border-glass-border bg-bg-secondary/60 p-3">
        {isEditing ? (
          <CommentEditor
            entityType={entityType}
            entityId={entityId}
            initialContent={comment.contentJson}
            commentId={comment.id}
            onCommentAdded={onUpdated}
            onCancelEdit={() => setIsEditing(false)}
            onSaved={() => {
              setIsEditing(false);
              onUpdated();
            }}
          />
        ) : (
          <>
            <div
              className="tiptap-content prose-sm text-sm text-fg-secondary"
              dangerouslySetInnerHTML={{ __html: comment.contentHtml }}
            />

            {comment.attachments.length > 0 && (
              <CommentAttachmentList attachments={comment.attachments} />
            )}

            <div className="mt-2 flex items-center justify-between">
              <time
                className="font-mono text-micro text-fg-muted"
                title={formatFullDate(createdAt)}
              >
                {formatRelativeTime(createdAt)}
              </time>
              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="text-xs text-fg-muted hover:text-fg-secondary"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="text-xs text-fg-muted hover:text-accent-red disabled:opacity-50"
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
