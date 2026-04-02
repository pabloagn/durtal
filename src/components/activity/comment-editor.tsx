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
  const [editorEmpty, setEditorEmpty] = useState(true);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder: "Leave a comment..." }),
    ],
    content: (initialContent as Parameters<typeof useEditor>[0] extends { content?: infer C } ? C : never) ?? "",
    onUpdate: ({ editor: e }) => {
      setEditorEmpty(e.isEmpty);
    },
    onCreate: ({ editor: e }) => {
      setEditorEmpty(e.isEmpty);
    },
    editorProps: {
      attributes: {
        class:
          "tiptap-content outline-none min-h-[60px] text-[13px] text-fg-primary px-3 py-2",
      },
    },
  });

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

  // Collapsed state: clean inline input like Linear
  if (!expanded && !isEditing) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => editor?.commands.focus(), 0);
        }}
        className="flex w-full items-center gap-2 rounded-sm border border-glass-border bg-bg-secondary/30 px-3 py-2 text-left transition-colors hover:border-fg-muted/20 hover:bg-bg-secondary/50"
      >
        <span className="flex-1 text-[13px] text-fg-muted">
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

  // Expanded state: editor with toolbar
  return (
    <div className="rounded-sm border border-glass-border bg-bg-secondary/30 focus-within:border-fg-muted/20">
      {/* Editor content */}
      <EditorContent editor={editor} />

      {/* Footer: toolbar + actions */}
      <div className="flex items-center justify-between border-t border-glass-border px-1.5 py-1">
        {/* Formatting toolbar */}
        <div className="flex items-center gap-0.5">
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

        {/* Right side: attachment + submit */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Attach file"
            className="flex items-center justify-center p-1.5 rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
          >
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>

          {isEditing && onCancelEdit && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="px-2.5 py-1 rounded-sm text-[11px] text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
            >
              Cancel
            </button>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || editorEmpty}
            className="flex h-6 w-6 items-center justify-center rounded-sm bg-accent-rose/80 text-fg-primary transition-colors hover:bg-accent-rose disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
