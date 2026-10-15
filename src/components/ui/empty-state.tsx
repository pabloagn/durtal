import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** An error view: the same block, its icon in the red text colour (contract section 8) */
  tone?: "error";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone,
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
      <h3 className="type-item-title">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-fg-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
