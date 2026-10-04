/** The directory while it loads: the shapes of its search, roles and rows, still. */
export default function OrganizationsLoading() {
  return (
    <div role="status" aria-label="Loading organizations" className="motion-safe:animate-pulse">
      <div className="mb-8 space-y-3">
        <div className="h-10 w-1/3 rounded-sm bg-bg-secondary" />
        <div className="h-4 w-1/2 rounded-sm bg-bg-secondary" />
      </div>
      <div className="mb-3 h-8 max-w-sm rounded-sm bg-bg-secondary" />
      <div className="mb-6 flex gap-2">
        {[0, 1, 2, 3].map((chip) => (
          <div key={chip} className="h-8 w-24 rounded-sm bg-bg-secondary" />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="mb-3 h-11 rounded-sm bg-bg-secondary" />
      ))}
    </div>
  );
}
