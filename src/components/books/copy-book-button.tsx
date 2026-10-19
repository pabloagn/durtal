"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { SpriteIcon } from "@/components/ui/sprite-icon";
import { toast } from "@/lib/notifications/toast";
import { copyBookText } from "@/lib/utils/copy-book";

interface Props {
  title: string;
  authorNames?: readonly string[];
  authorName?: string;
  className?: string;
  /** On a cover: glass on the image instead of a plain button */
  glass?: boolean;
  /** Dense rows use sm; mixed header actions use md. */
  size?: "sm" | "md";
  /** What it copies, for its name and toast: a film's title and director (SLN-1059) */
  what?: string;
}

export function CopyBookButton({ title, authorNames, authorName, className = "", glass = false, size = "sm", what = "book title and author" }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleCopy(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await copyBookText(title, authorNames ?? (authorName ? [authorName] : []));
      setCopied(true);
      toast.success(`${what[0].toUpperCase()}${what.slice(1)} copied`);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      toast.error("Could not copy. Allow clipboard access and try again.");
    }
  }

  const label = copied ? "Copied" : `Copy ${what}`;
  // Named for its record: a page of cards would have many buttons of one
  // name (SLN-1123). "film title and director" names "the title and director of"
  const name = copied ? label : `Copy the ${what.replace(/^\S+ /, "")} of ${title}`;

  return <button type="button" onClick={handleCopy} aria-label={name} data-tooltip={label}
    className={`inline-flex ${glass ? "chip-button glass-chip" : (size === "sm" ? "action-icon-sm" : "action-icon")} ${className}`}>
    {copied ? (
      <Check className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    ) : (
      // From the sprite: this button repeats on every card
      <SpriteIcon name="copy" className="h-4 w-4" />
    )}
  </button>;
}
