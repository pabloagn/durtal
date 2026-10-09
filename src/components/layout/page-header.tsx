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
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 max-w-full">
          <h1 className="type-page-title [overflow-wrap:anywhere]">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-secondary">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {tabs}
    </div>
  );
}
