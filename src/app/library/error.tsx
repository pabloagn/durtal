"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function LibraryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="mb-5 rounded-sm border border-glass-border bg-bg-secondary/50 p-3.5">
        <svg className="h-6 w-6 text-fg-muted" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <h2 className="font-serif text-xl text-fg-primary">Something went wrong</h2>
      <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-fg-secondary">
        An error occurred while loading this page.
      </p>
      <div className="mt-5 flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center rounded-sm border border-glass-border bg-bg-secondary px-4 py-1.5 text-sm text-fg-primary transition-colors hover:bg-bg-tertiary"
        >
          Try again
        </button>
        <Link
          href="/library"
          className="inline-flex items-center rounded-sm border border-glass-border bg-bg-secondary px-4 py-1.5 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
        >
          Back to library
        </Link>
      </div>
    </div>
  );
}
