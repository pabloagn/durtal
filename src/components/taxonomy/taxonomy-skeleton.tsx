import { SkeletonBlock as Skeleton } from "@/components/shared/skeleton";
export function TaxonomySkeleton({
  kind,
}: {
  kind: "directory" | "family" | "term";
}) {
  return (
    <div
      role="status"
      aria-label="Loading classifications"
      className="space-y-6"
    >
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-12 w-64 max-w-full" />
      {kind !== "directory" && <Skeleton className="h-9 w-full max-w-md" />}
      <div
        className={
          kind === "directory"
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "space-y-3"
        }
      >
        {Array.from({ length: kind === "directory" ? 6 : 8 }, (_, i) => (
          <Skeleton
            key={i}
            className={kind === "directory" ? "h-36 w-full" : "h-12 w-full"}
          />
        ))}
      </div>
    </div>
  );
}
