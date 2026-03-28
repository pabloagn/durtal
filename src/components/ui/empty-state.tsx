import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 rounded-sm border border-bg-tertiary bg-bg-secondary p-3">
        <Icon className="h-6 w-6 text-fg-muted" strokeWidth={1.5} />
      </div>
      <h3 className="font-serif text-lg text-fg-primary">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-center text-sm text-fg-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
