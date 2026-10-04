interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

/** Page content: opaque, never glass (glass is for what floats above the page) */
export function Card({ children, className = "", hover }: CardProps) {
  return (
    <div
      className={`rounded-sm border border-glass-border bg-bg-secondary ${
        hover ? "card-interactive" : ""
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
    <div className={`border-b border-glass-border px-5 py-3.5 ${className}`}>
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
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
