import type { ReactNode } from "react";

/**
 * The body of a detail page, under its header: the reading column (what the
 * page is about: description, editions, books) and, from lg up, a narrower
 * record column on the right (facts, taxonomy, orders, links). Below lg the
 * record follows the reading content. With no record, the reading column
 * takes the full width; with nothing to read (pass no children), the record
 * keeps its own width.
 */
export function DetailColumns({
  children,
  record,
}: {
  children?: ReactNode;
  record?: ReactNode;
}) {
  if (!record) return <>{children}</>;
  if (!children) return <div className="max-w-[18rem]">{record}</div>;
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-12">
      <div className="min-w-0">{children}</div>
      <aside aria-label="Record" className="min-w-0">
        {record}
      </aside>
    </div>
  );
}

/** The record: one quiet panel; its groups are split by hairlines */
export function RecordPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-8 divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary">
      {children}
    </div>
  );
}

/** A titled group in the record: Details, Taxonomy, Orders, Links */
export function RecordGroup({
  title,
  action,
  children,
}: {
  title: string;
  /** A small text link at the right of the title ("Pipeline") */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="type-caption">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label-and-value rows of a record group */
export function RecordFields({ children }: { children: ReactNode }) {
  return <dl className="space-y-3">{children}</dl>;
}

export function RecordField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd className="mt-0.5 text-sm text-fg-primary">{children}</dd>
    </div>
  );
}
