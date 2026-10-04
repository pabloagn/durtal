/** A painting while it loads: the shapes of its picture and identity, still. */
export default function PaintingLoading() {
  return (
    <div role="status" aria-label="Loading the painting" className="motion-safe:animate-pulse">
      <div className="mb-6 h-4 w-28 rounded-sm bg-bg-secondary" />
      <div className="mb-10 grid gap-6 lg:grid-cols-2 lg:gap-10">
        <div className="aspect-[4/5] w-full max-w-md rounded-sm bg-bg-tertiary lg:max-w-none" />
        <div className="space-y-4">
          <div className="h-10 w-2/3 rounded-sm bg-bg-secondary" />
          <div className="space-y-2.5 pt-3">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="h-4 w-1/2 rounded-sm bg-bg-secondary" />
            ))}
          </div>
        </div>
      </div>
      <div className="h-6 w-24 rounded-sm bg-bg-secondary" />
    </div>
  );
}
