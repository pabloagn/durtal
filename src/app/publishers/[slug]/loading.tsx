/** A publisher while it loads: the shapes of its logo, name and books, still. */
export default function PublisherLoading() {
  return (
    <div role="status" aria-label="Loading the publisher" className="motion-safe:animate-pulse">
      <div className="mb-6 h-4 w-32 rounded-sm bg-bg-secondary" />
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:gap-8">
        <div className="size-40 shrink-0 rounded-sm bg-bg-tertiary" />
        <div className="flex-1 space-y-4">
          <div className="h-12 w-2/3 rounded-sm bg-bg-secondary" />
          <div className="h-4 w-1/3 rounded-sm bg-bg-secondary" />
        </div>
      </div>
      <div className="mb-4 h-8 w-40 rounded-sm bg-bg-secondary" />
      <div className="mb-6 h-8 rounded-sm bg-bg-secondary" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="aspect-[2/3] rounded-sm bg-bg-tertiary" />
        ))}
      </div>
    </div>
  );
}
