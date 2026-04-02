"use client";

import { useState, useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { common, createLowlight } from "lowlight";
import {
  Paperclip,
  ArrowUp,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Braces,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
} from "lucide-react";

const lowlight = createLowlight(common);

interface CommentEditorProps {
  entityType: "work" | "author";
  entityId: string;
  onCommentAdded?: () => void;
  /** Tiptap JSON for editing existing comments */
  initialContent?: unknown;
  commentId?: string;
  onCancelEdit?: () => void;
  onSaved?: () => void;
}

function ToolbarButton({
  onClick,
  title,
  active = false,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center p-1.5 rounded-sm transition-colors ${
        active
          ? "bg-bg-tertiary text-fg-primary"
          : "text-fg-muted hover:bg-bg-tertiary hover:text-fg-secondary"
      }`}
    >
      {children}
    </button>
  );
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder: "Leave a comment..." }),
    ],
    content: (initialContent as Parameters<typeof useEditor>[0] extends { content?: infer C } ? C : never) ?? "",
    editorProps: {
      attributes: {
        class:
          "tiptap-content outline-none min-h-[80px] text-sm text-fg-primary px-3 py-2",
      },
    },
  });

  const isEmpty = useCallback(() => {
    if (!editor) return true;
    return editor.isEmpty;
  }, [editor]);

  const handleSubmit = useCallback(async () => {
    if (!editor || isEmpty() || submitting) return;

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
        await fetch("/api/comments", {
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
        onCommentAdded?.();
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    editor,
    isEmpty,
    submitting,
    isEditing,
    commentId,
    entityType,
    entityId,
    onCommentAdded,
    onSaved,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSubmit();
        return;
      }

      if (event.key === "Escape") {
        if (isEditing) {
          onCancelEdit?.();
        } else if (isEmpty()) {
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
  }, [editor, handleSubmit, isEmpty, isEditing, onCancelEdit]);

  const handleLinkInsert = useCallback(() => {
    if (!editor) return;

    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previousUrl ?? "https://");

    if (url === null) return;

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  // Collapsed state: single-row input facade
  if (!expanded && !isEditing) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          // Focus the editor after expanding
          setTimeout(() => editor?.commands.focus(), 0);
        }}
        className="flex w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2 text-left transition-colors hover:border-fg-muted/10"
      >
        <span className="flex-1 text-sm text-fg-muted">
          Leave a comment...
        </span>
        <Paperclip
          className="h-3.5 w-3.5 text-fg-muted"
          strokeWidth={1.5}
        />
        <ArrowUp
          className="h-3.5 w-3.5 text-fg-muted"
          strokeWidth={1.5}
        />
      </button>
    );
  }

  // Expanded state: toolbar + editor + footer
  return (
    <div className="rounded-sm border border-glass-border bg-bg-secondary/40">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-glass-border px-1.5 py-1">
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold"
          active={editor?.isActive("bold") ?? false}
        >
          <Bold className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic"
          active={editor?.isActive("italic") ?? false}
        >
          <Italic className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="Underline"
          active={editor?.isActive("underline") ?? false}
        >
          <UnderlineIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          title="Strikethrough"
          active={editor?.isActive("strike") ?? false}
        >
          <Strikethrough className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <div className="mx-0.5 h-4 w-px bg-glass-border" />

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleCode().run()}
          title="Code"
          active={editor?.isActive("code") ?? false}
        >
          <Code className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          title="Code Block"
          active={editor?.isActive("codeBlock") ?? false}
        >
          <Braces className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <div className="mx-0.5 h-4 w-px bg-glass-border" />

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="Bullet List"
          active={editor?.isActive("bulletList") ?? false}
        >
          <List className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          title="Numbered List"
          active={editor?.isActive("orderedList") ?? false}
        >
          <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <div className="mx-0.5 h-4 w-px bg-glass-border" />

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
          active={editor?.isActive("blockquote") ?? false}
        >
          <Quote className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>

        <ToolbarButton
          onClick={handleLinkInsert}
          title="Link"
          active={editor?.isActive("link") ?? false}
        >
          <LinkIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-glass-border px-2 py-1.5">
        <button
          type="button"
          title="Attach file"
          className="flex items-center justify-center p-1.5 rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
        >
          <Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>

        <div className="flex items-center gap-2">
          {isEditing && onCancelEdit && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-3 py-1 rounded-sm text-xs text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || isEmpty()}
            className="flex items-center gap-1.5 rounded-sm bg-accent-rose/80 px-3 py-1 text-xs text-fg-primary transition-colors hover:bg-accent-rose disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUp className="h-3 w-3" strokeWidth={2} />
            {submitting
              ? "Saving..."
              : isEditing
                ? "Save"
                : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
