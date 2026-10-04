import { Button } from "@/components/ui/button";

/**
 * Placeholder for a view whose data loads on demand (map, timeline): a
 * loading line, or an error line with a Retry button when `onRetry` is set.
 */
export function ViewStatus({
  label,
  onRetry,
  className = "h-full",
}: {
  label: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role={onRetry ? "alert" : "status"}
      className={`flex flex-col items-center justify-center gap-3 font-mono text-sm text-fg-secondary ${className}`}
    >
      <p>{label}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
