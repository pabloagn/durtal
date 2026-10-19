"use client";

import type { ActivityEntityType } from "@/lib/activity/entities";
import { useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
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
  entityType: ActivityEntityType;
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
  // The comment's text, read when Delete is pressed, for the confirmation to name it
  const [confirming, setConfirming] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  /** A comment is a record: deleting it asks first and has no Undo (SLN-1152, SLN-1460) */
  async function handleDelete() {
    const ok = await fetch(`/api/comments/${comment.id}`, { method: "DELETE" }).then((res) => res.ok, () => false);
    if (!ok) {
      toast.error("Could not delete the comment");
      return;
    }
    // The focus stays in the timeline: on the next comment, else the comment box
    const timeline = root.current?.closest("[data-activity-timeline]");
    const comments = [...(timeline?.querySelectorAll<HTMLElement>("[data-comment]") ?? [])];
    const next = comments[comments.indexOf(root.current!) + 1]?.querySelector<HTMLElement>("[data-comment-delete]");
    setConfirming(null);
    onDeleted(comment.id);
    setTimeout(() => {
      (next?.isConnected ? next : timeline?.querySelector<HTMLElement>("[data-comment-box] button, [data-comment-box] [contenteditable=true]"))?.focus();
    });
  }
  const attachments = comment.attachments.length;

  const relative = formatRelativeTime(createdAt);
  const full = formatFullDate(createdAt);

  return (
    <div ref={root} className="relative flex gap-3 py-1.5" data-comment="">
      {/* Icon dot sitting on the timeline line, centred on the "Comment" label:
          the card's border and top padding (11px) put the label's line there */}
      <div className="relative z-10 mt-[11px] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-bg-primary">
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
            {/* Top-aligned, so taller touch buttons don't move the label off the dot */}
            <div className="flex items-start justify-between px-3 pt-2.5 pb-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-fg-primary">Comment</span>
                <time
                  className="text-micro text-fg-secondary"
                  data-tooltip={full}
                >
                  {relative}
                </time>
              </div>

              {/* Hover actions */}
              {/* Shown on hover; a touch screen has none, so there they always show */}
              <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-sm px-1.5 py-0.5 text-micro text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                >
                  Edit<span className="sr-only"> comment</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const text = new DOMParser().parseFromString(comment.contentHtml, "text/html").body.textContent ?? "";
                    setConfirming(text.replace(/\s+/g, " ").trim());
                  }}
                  data-comment-delete=""
                  className="rounded-sm px-1.5 py-0.5 text-micro text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-accent-red-text pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                >
                  Delete<span className="sr-only"> comment</span>
                </button>
              </div>
            </div>

            {/* Comment body */}
            <div
              className="tiptap-content px-3 pt-1.5 pb-2.5 text-xs leading-relaxed text-fg-secondary"
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
      <ConfirmDeleteDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Delete comment"
        name={!confirming ? `Comment, ${relative}` : confirming.length > 140 ? `${confirming.slice(0, 140).trimEnd()}…` : confirming}
        description={attachments
          ? `The comment and its ${attachments === 1 ? "attachment are" : `${attachments} attachments are`} deleted. This cannot be undone.`
          : "The comment is deleted. This cannot be undone."}
        onConfirm={handleDelete}
      />
    </div>
  );
}
