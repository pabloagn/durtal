/** An organization while it loads: the shapes of its name, roles and parts, still. */
export default function OrganizationLoading() {
  return (
    <div role="status" aria-label="Loading the organization" className="motion-safe:animate-pulse">
      <div className="mb-6 h-4 w-32 rounded-sm bg-bg-secondary" />
      <div className="mb-10 space-y-3">
        <div className="h-10 w-1/2 rounded-sm bg-bg-secondary" />
        <div className="h-4 w-1/4 rounded-sm bg-bg-secondary" />
      </div>
      <div className="mb-4 h-6 w-28 rounded-sm bg-bg-secondary" />
      <div className="flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((card) => (
          <div key={card} className="aspect-[2/3] w-[160px] shrink-0 rounded-sm bg-bg-tertiary" />
        ))}
      </div>
    </div>
  );
}
