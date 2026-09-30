"use client";
export default function HarmonizeError({ reset }: { reset: () => void }) {
  return (
    <div className="py-20">
      <h1 className="font-serif text-3xl">
        The catalogue scan was interrupted
      </h1>
      <p className="mt-3 text-sm text-fg-secondary">
        Your records are unchanged. Retry when the connection is available.
      </p>
      <button
        onClick={reset}
        className="mt-6 rounded-sm border border-glass-border px-4 py-2 text-sm"
      >
        Try again
      </button>
    </div>
  );
}
