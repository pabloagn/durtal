/** A perfume while it loads: the shapes of its bottle and identity, still. */
export default function PerfumeLoading() {
  return (
    <div role="status" aria-label="Loading the perfume" className="motion-safe:animate-pulse">
      <div className="mb-6 h-4 w-28 rounded-sm bg-bg-secondary" />
      <div className="mb-10 grid gap-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-8">
        <div className="mx-auto aspect-square w-full max-w-[320px] rounded-sm bg-bg-tertiary md:max-w-none" />
        <div className="space-y-4">
          <div className="h-10 w-2/3 rounded-sm bg-bg-secondary" />
          <div className="h-4 w-1/3 rounded-sm bg-bg-secondary" />
          <div className="space-y-2.5 pt-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="h-4 w-1/2 rounded-sm bg-bg-secondary" />
            ))}
          </div>
        </div>
      </div>
      <div className="h-6 w-24 rounded-sm bg-bg-secondary" />
    </div>
  );
}
