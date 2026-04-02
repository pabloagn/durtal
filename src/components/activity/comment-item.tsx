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

  const relative = formatRelativeTime(createdAt);
  const full = formatFullDate(createdAt);

  return (
    <div className="relative flex gap-3 py-1.5">
      {/* Icon dot sitting on the timeline line */}
      <div className="relative z-10 mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-bg-primary">
        <MessageSquare className="h-3.5 w-3.5 text-fg-muted" strokeWidth={1.5} />
      </div>

      {/* Comment card */}
      <div className="group min-w-0 flex-1">
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
          <div className="rounded-sm border border-glass-border bg-bg-secondary/40">
            {/* Comment header */}
            <div className="flex items-center justify-between px-3 pt-2.5 pb-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-fg-primary">Comment</span>
                <time
                  className="text-[11px] text-fg-muted"
                  title={full}
                >
                  {relative}
                </time>
              </div>

              {/* Hover actions */}
              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-sm px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="rounded-sm px-1.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-accent-red disabled:opacity-50"
                >
                  {isDeleting ? "..." : "Delete"}
                </button>
              </div>
            </div>

            {/* Comment body */}
            <div
              className="tiptap-content px-3 pt-1.5 pb-2.5 text-[13px] leading-relaxed text-fg-secondary"
              dangerouslySetInnerHTML={{ __html: comment.contentHtml }}
            />

            {comment.attachments.length > 0 && (
              <div className="px-3 pb-2.5">
                <CommentAttachmentList attachments={comment.attachments} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
