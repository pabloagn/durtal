interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = "", hover }: CardProps) {
  return (
    <div
      className={`rounded-sm border border-bg-tertiary bg-bg-secondary ${
        hover
          ? "transition-all hover:border-fg-muted/30 hover:shadow-lg hover:shadow-accent-rose/5"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-b border-bg-tertiary px-4 py-3 ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
