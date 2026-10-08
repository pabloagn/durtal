"use client";

import type { ActivityEntityType } from "@/lib/activity/entities";
import { useState, useCallback, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import Underline from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import {
  Paperclip,
  ArrowUp,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Braces,
} from "lucide-react";
import { TiptapEditor, ToolbarButton, ToolbarDivider } from "@/components/shared/tiptap-editor";

const lowlight = createLowlight(common);

interface CommentEditorProps {
  entityType: ActivityEntityType;
  entityId: string;
  onCommentAdded?: (newComment?: {
    id: string;
    contentHtml: string;
    contentJson: unknown;
    eventId: string;
  }) => void;
  /** Tiptap JSON for editing existing comments */
  initialContent?: unknown;
  commentId?: string;
  onCancelEdit?: () => void;
  onSaved?: () => void;
}

export function CommentEditor({
  entityType,
  entityId,
  onCommentAdded,
  initialContent,
  commentId,
  onCancelEdit,
  onSaved,
}: CommentEditorProps) {
  const isEditing = !!commentId;
  const [expanded, setExpanded] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [editorEmpty, setEditorEmpty] = useState(true);

  const [editor, setEditor] = useState<Editor | null>(null);
  const extensions = useState(() => [Underline, CodeBlockLowlight.configure({ lowlight })])[0];
  const onReady = useCallback((e: Editor) => {
    setEditor(e);
    setEditorEmpty(e.isEmpty);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!editor || editorEmpty || submitting) return;

    const contentHtml = editor.getHTML();
    const contentJson = editor.getJSON();

    setSubmitting(true);
    try {
      if (isEditing && commentId) {
        await fetch(`/api/comments/${commentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentHtml, contentJson }),
        });
        onSaved?.();
      } else {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entityType,
            entityId,
            contentHtml,
            contentJson,
          }),
        });

        editor.commands.clearContent();
        setExpanded(false);

        if (res.ok) {
          const data = await res.json();
          // Pass the created comment data for optimistic insertion
          onCommentAdded?.({
            id: data.id,
            contentHtml,
            contentJson,
            eventId: data.eventId ?? `optimistic-${Date.now()}`,
          });
        } else {
          // Fallback: just trigger a refetch
          onCommentAdded?.();
        }
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    editor,
    editorEmpty,
    submitting,
    isEditing,
    commentId,
    entityType,
    entityId,
    onCommentAdded,
    onSaved,
  ]);

  // Keyboard shortcuts. A collapse unmounts the editor and destroys it, so
  // `editor` can be a destroyed one until the next expand hands a new one
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSubmit();
        return;
      }

      if (event.key === "Escape") {
        if (isEditing) {
          onCancelEdit?.();
        } else if (editorEmpty) {
          setExpanded(false);
          editor.commands.blur();
        }
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener("keydown", handleKeyDown);
    return () => {
      editorElement.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, handleSubmit, editorEmpty, isEditing, onCancelEdit]);

  // Collapsed state: clean inline input like Linear
  if (!expanded && !isEditing) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
        }}
        className="flex w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-secondary/30 px-3 py-2 text-left transition-colors hover:border-fg-muted/20 hover:bg-bg-secondary/50 pointer-coarse:min-h-11"
      >
        <span className="flex-1 text-xs text-fg-secondary">
          Leave a comment...
        </span>
        <Paperclip
          className="h-3.5 w-3.5 text-fg-muted/50"
          strokeWidth={1.5}
        />
        <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-fg-muted/10">
          <ArrowUp
            className="h-3 w-3 text-fg-muted/50"
            strokeWidth={2}
          />
        </div>
      </button>
    );
  }

  // Expanded state: the shared editor with the comment's extra tools and actions
  return (
    <TiptapEditor
      value={initialContent ? { html: "", json: initialContent } : null}
      label="Comment"
      hideLabel
      placeholder="Leave a comment..."
      kit={{ code: {}, strike: {} }}
      extensions={extensions}
      autoFocus
      onReady={onReady}
      onChange={() => editor && setEditorEmpty(editor.isEmpty)}
      contentClassName="min-h-[60px] text-xs"
      extraTools={(e) => (
        <>
          <ToolbarButton onClick={() => e.chain().focus().toggleUnderline().run()} label="Underline" active={e.isActive("underline")}>
            <UnderlineIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton onClick={() => e.chain().focus().toggleStrike().run()} label="Strikethrough" active={e.isActive("strike")}>
            <Strikethrough className="h-3.5 w-3.5" strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton onClick={() => e.chain().focus().toggleCode().run()} label="Code" active={e.isActive("code")}>
            <Code className="h-3.5 w-3.5" strokeWidth={1.5} />
          </ToolbarButton>
          <ToolbarButton onClick={() => e.chain().focus().toggleCodeBlock().run()} label="Code Block" active={e.isActive("codeBlock")}>
            <Braces className="h-3.5 w-3.5" strokeWidth={1.5} />
          </ToolbarButton>
        </>
      )}
      actions={
        <>
          <button
            type="button"
            aria-label="Attach file"
            data-tooltip="Attach file"
            className="flex items-center justify-center p-1.5 rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
          >
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {isEditing && onCancelEdit && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-2.5 py-1 rounded-sm text-micro text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            >
              Cancel
            </button>
          )}

          <button
            aria-label={isEditing ? "Save comment" : "Post comment"}
            data-tooltip={isEditing ? "Save comment" : "Post comment"}
            type="button"
            onClick={handleSubmit}
            disabled={submitting || editorEmpty}
            className="flex h-6 w-6 items-center justify-center rounded-sm bg-action-fill text-action-fg transition-colors hover:bg-action-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </>
      }
    />
  );
}
