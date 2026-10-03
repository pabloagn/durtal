interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Navigation below the title, such as the collection switch; it sets its own spacing */
  tabs?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  tabs,
}: PageHeaderProps) {
  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="type-page-title">{title}</h1>
          {description && (
            <p className="mt-1.5 text-sm text-fg-secondary">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {tabs}
    </div>
  );
}
