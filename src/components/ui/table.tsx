interface TableProps {
  children: React.ReactNode;
  className?: string;
}

export function Table({ children, className = "" }: TableProps) {
  return (
    <div className="overflow-x-auto rounded-sm border border-bg-tertiary">
      <table className={`w-full text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function TableHeader({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <thead className={`border-b border-bg-tertiary bg-bg-secondary ${className}`}>
      {children}
    </thead>
  );
}

export function TableBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <tbody className={className}>{children}</tbody>;
}

export function TableRow({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      className={`border-b border-bg-tertiary last:border-0 ${
        onClick
          ? "cursor-pointer transition-colors hover:bg-bg-secondary"
          : ""
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function TableHead({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 text-left font-serif text-xs font-normal text-fg-secondary ${className}`}
    >
      {children}
    </th>
  );
}

export function TableCell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2.5 text-fg-primary ${className}`}>{children}</td>;
}
