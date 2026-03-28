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
    <div className="flex flex-col items-center justify-center py-20">
      <div className="mb-5 rounded-sm border border-glass-border bg-bg-secondary/50 p-3.5">
        <Icon className="h-6 w-6 text-fg-muted" strokeWidth={1.5} />
      </div>
      <h3 className="font-serif text-xl text-fg-primary">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-fg-secondary">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
