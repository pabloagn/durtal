import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** An error view: the same block, its icon in the red text colour (contract section 8) */
  tone?: "error";
  /**
   * `h1` when the view is the whole page, as an error or not-found view is
   * (task 0615); `h2` when it is the whole of a page under a heading of its
   * section's, as a settings page's error view is under "Settings"
   */
  heading?: "h1" | "h2" | "h3";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone,
  heading: Heading = "h3",
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      {/* The mark is decoration: the title says what the page is (docs/03, Iconography) */}
      <div aria-hidden="true" data-decorative="" className="mb-5 rounded-sm border border-glass-border bg-bg-secondary/50 p-3.5">
        <Icon
          className={`h-6 w-6 ${tone === "error" ? "text-accent-red-text" : "text-fg-muted"}`}
          strokeWidth={1.5}
        />
      </div>
      <Heading className="type-item-title">{title}</Heading>
      {description && (
        <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-fg-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
