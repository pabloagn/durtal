"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useEditor, EditorContent, type AnyExtension, type Editor } from "@tiptap/react";
import StarterKit, { type StarterKitOptions } from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, Quote, Link as LinkIcon } from "lucide-react";

/*
 * The rich text field for reviews and notes (SLN-447): bold, italic, link,
 * bulleted and numbered lists and quote, as HTML and Tiptap JSON. No submit,
 * no fetch, no attachments. `CommentEditor` builds on it with its own
 * extensions and toolbar buttons. Author bios keep `rich-text-editor.tsx`.
 */

export interface RichValue {
  html: string;
  json: unknown | null;
}

export function ToolbarButton({
  onClick,
  label,
  active = false,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-tooltip={label}
      aria-pressed={active}
      className={`flex items-center justify-center rounded-sm p-1.5 transition-colors pointer-coarse:h-11 pointer-coarse:w-11 ${
        active ? "bg-bg-tertiary text-fg-primary" : "text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
      }`}
    >
      {children}
    </button>
  );
}

export const ToolbarDivider = () => <div className="mx-0.5 h-4 w-px bg-glass-border" />;

const ICON = "h-3.5 w-3.5";

export function TiptapEditor({
  value,
  onChange,
  placeholder,
  label,
  hideLabel = false,
  kit,
  extensions = [],
  extraTools,
  actions,
  onReady,
  autoFocus = false,
  className = "",
  contentClassName = "min-h-[96px] text-sm",
}: {
  value: RichValue | null;
  onChange?: (value: RichValue) => void;
  placeholder?: string;
  /** Names the field: its visible label and the editable area's aria-label */
  label: string;
  hideLabel?: boolean;
  /** StarterKit options over the review defaults (comments enable code and strike) */
  kit?: Partial<StarterKitOptions>;
  /** More extensions (comments add underline and code blocks) */
  extensions?: AnyExtension[];
  /** More toolbar buttons, after Italic */
  extraTools?: (editor: Editor) => ReactNode;
  /** Buttons at the right end of the toolbar (comments: attach, cancel, post) */
  actions?: ReactNode;
  onReady?: (editor: Editor) => void;
  autoFocus?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const id = useId();
  const changed = useRef(onChange);
  changed.current = onChange;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: false,
        ...kit,
      }),
      Link.configure({ openOnClick: false }),
      ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
      ...extensions,
    ],
    // Tiptap JSON when known; an imported review opens from its HTML
    content: (value?.json ?? value?.html ?? "") as never,
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor: e }) => changed.current?.({ html: e.getHTML(), json: e.getJSON() }),
    editorProps: {
      attributes: {
        class: `tiptap-content outline-none px-3 py-2 text-fg-primary ${contentClassName}`,
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
        id,
      },
    },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  function link() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const is = (name: string) => editor?.isActive(name) ?? false;
  return (
    <div className={className}>
      {!hideLabel && (
        <label htmlFor={id} className="type-label mb-1.5 block">
          {label}
        </label>
      )}
      <div className="rounded-sm border border-glass-border bg-bg-secondary/30 focus-within:border-accent-rose">
        <EditorContent editor={editor} />
        <div className="flex items-center justify-between border-t border-glass-border px-1.5 py-1">
          <div className="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label={`${label} formatting`}>
            <ToolbarButton onClick={() => editor?.chain().focus().toggleBold().run()} label="Bold" active={is("bold")}>
              <Bold className={ICON} strokeWidth={1.5} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor?.chain().focus().toggleItalic().run()} label="Italic" active={is("italic")}>
              <Italic className={ICON} strokeWidth={1.5} />
            </ToolbarButton>
            {editor && extraTools?.(editor)}
            <ToolbarDivider />
            <ToolbarButton onClick={() => editor?.chain().focus().toggleBulletList().run()} label="Bullet List" active={is("bulletList")}>
              <List className={ICON} strokeWidth={1.5} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor?.chain().focus().toggleOrderedList().run()} label="Numbered List" active={is("orderedList")}>
              <ListOrdered className={ICON} strokeWidth={1.5} />
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton onClick={() => editor?.chain().focus().toggleBlockquote().run()} label="Blockquote" active={is("blockquote")}>
              <Quote className={ICON} strokeWidth={1.5} />
            </ToolbarButton>
            <ToolbarButton onClick={link} label="Link" active={is("link")}>
              <LinkIcon className={ICON} strokeWidth={1.5} />
            </ToolbarButton>
          </div>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
