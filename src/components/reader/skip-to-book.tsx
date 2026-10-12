"use client";

/** First reader focus stop; native Tab continues through the controls in DOM order. */
export function SkipToBook({ onSkip }: { onSkip(): void }) {
  return (
    <a
      href="#reader-book"
      data-reader-skip
      onClick={(event) => {
        event.preventDefault();
        onSkip();
      }}
      className="sr-only fixed left-3 top-3 z-50 rounded-sm bg-bg-primary text-fg-primary focus:not-sr-only focus:px-4 focus:py-3 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-fg-primary"
    >
      Skip to the book
    </a>
  );
}
