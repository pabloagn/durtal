"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyBookText } from "@/lib/utils/copy-book";

interface Props {
  title: string;
  authorNames?: readonly string[];
  authorName?: string;
  className?: string;
}

export function CopyBookButton({ title, authorNames, authorName, className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleCopy(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await copyBookText(title, authorNames ?? (authorName ? [authorName] : []));
      setCopied(true);
      toast.success("Book title and author copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      toast.error("Could not copy. Allow clipboard access and try again.");
    }
  }

  const label = copied ? "Copied" : "Copy book title and author";
  const Icon = copied ? Check : Copy;
  return <button type="button" onClick={handleCopy} aria-label={label} title={label}
    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-rose ${className}`}>
    <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
  </button>;
}
