export default function Loading() {
  return (
    <div
      className="space-y-8 py-4"
      role="status"
      aria-label="Scanning catalogue quality"
    >
      <div>
        <p className="text-xs uppercase tracking-widest text-fg-secondary">
          Library care
        </p>
        <h1 className="mt-3 font-serif text-4xl">Harmonize</h1>
        <p className="mt-3 text-sm text-fg-secondary">
          Looking for records that need a little attention…
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-28 animate-pulse rounded-sm border border-glass-border bg-bg-secondary"
          />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-sm border border-glass-border bg-bg-secondary" />
    </div>
  );
}
