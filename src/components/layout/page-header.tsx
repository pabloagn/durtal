interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-10 flex items-end justify-between">
      <div>
        <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-fg-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
