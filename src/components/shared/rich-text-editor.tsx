"use client";

import { useRef, useCallback } from "react";
import {
  Bold,
  Italic,
  Underline,
  Link,
  List,
  ListOrdered,
  RemoveFormatting,
} from "lucide-react";
import { toast } from "sonner";
import { isSafeLinkUrl, plainTextToHtml } from "@/lib/utils/html-text";

interface RichTextEditorProps {
  label?: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  disabled?: boolean;
}

function ToolbarButton({
  onClick,
  label,
  children,
  disabled,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-tooltip={label}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:opacity-40 disabled:cursor-not-allowed pointer-coarse:size-11"
    >
      {children}
    </button>
  );
}

export function RichTextEditor({
  label,
  value,
  onChange,
  placeholder = "",
  rows = 6,
  disabled = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  const exec = useCallback(
    (command: string, val?: string) => {
      if (disabled) return;
      document.execCommand(command, false, val);
      // Read back the HTML from the contentEditable div
      if (editorRef.current) {
        onChange(editorRef.current.innerHTML);
      }
    },
    [disabled, onChange],
  );

  const handleBold = () => exec("bold");
  const handleItalic = () => exec("italic");
  const handleUnderline = () => exec("underline");
  const handleUnorderedList = () => exec("insertUnorderedList");
  const handleOrderedList = () => exec("insertOrderedList");
  const handleRemoveFormat = () => exec("removeFormat");

  const handleLink = () => {
    if (disabled) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";
    const url = prompt("Enter URL:", selectedText.startsWith("http") ? selectedText : "https://");
    if (!url) return;
    if (!isSafeLinkUrl(url)) {
      toast.error("Only http and https links are allowed");
      return;
    }
    exec("createLink", url.trim());
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    // Paste as plain text to avoid importing weird formatting. The text is
    // escaped, so pasted markup such as "<img onerror=…>" stays literal text.
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, plainTextToHtml(text));
    handleInput();
  };

  // Enter starts a <p>, not a <div>: the server keeps paragraphs and drops
  // other block tags when it sanitizes the HTML (sanitizeDescriptionHtml)
  const handleFocus = () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
  };

  // Approximate height from rows
  const minHeight = rows * 24;

  return (
    <div>
      {label && (
        <label className="type-label mb-1.5 block">
          {label}
        </label>
      )}
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-sm border border-b-0 border-glass-border bg-bg-secondary px-1.5 py-1">
        <ToolbarButton onClick={handleBold} label="Bold" disabled={disabled}>
          <Bold className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
        <ToolbarButton onClick={handleItalic} label="Italic" disabled={disabled}>
          <Italic className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
        <ToolbarButton onClick={handleUnderline} label="Underline" disabled={disabled}>
          <Underline className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-glass-border pointer-coarse:hidden" />
        <ToolbarButton onClick={handleLink} label="Insert Link" disabled={disabled}>
          <Link className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-glass-border pointer-coarse:hidden" />
        <ToolbarButton onClick={handleUnorderedList} label="Bullet List" disabled={disabled}>
          <List className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
        <ToolbarButton onClick={handleOrderedList} label="Numbered List" disabled={disabled}>
          <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-glass-border pointer-coarse:hidden" />
        <ToolbarButton onClick={handleRemoveFormat} label="Clear Formatting" disabled={disabled}>
          <RemoveFormatting className="h-3.5 w-3.5" strokeWidth={1.5} />
        </ToolbarButton>
      </div>
      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable={!disabled}
        onInput={handleInput}
        onPaste={handlePaste}
        onFocus={handleFocus}
        className="bio-content rounded-b-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-secondary outline-none transition-shadow focus:glass-input-focus overflow-y-auto"
        style={{ minHeight }}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: value }}
      />
    </div>
  );
}
