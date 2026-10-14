import type { ReactNode } from "react";
import { CapAlignedControls } from "@/components/shared/cap-aligned";

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

/** The row's classes: when it may wrap, and the title-to-controls gap (the gap less the star's pulled-out padding) */
export const DETAIL_TITLE_ROW = {
  // The star, Edit and the menu: 16px from the title; under it below a 24rem row
  standard: "gap-x-6 pointer-coarse:gap-x-7.5 @min-[24rem]:flex-nowrap",
  // The book's wider set: 12px from the title, as before; under it below a
  // 33rem row (39rem on touch, where the controls are 44px)
  wide: "gap-x-5 pointer-coarse:gap-x-6.5 pointer-fine:@min-[33rem]:flex-nowrap pointer-coarse:@min-[39rem]:flex-nowrap",
};

/**
 * The title row of a detail page's header: the h1 and its controls (the
 * star, Edit, the Actions menu), on the cap-height center of the title's
 * first line.
 *
 * A long title keeps the row's width on a phone: in a narrow row the
 * controls go under it when it would not fit on one line beside them; in a
 * wider row they stay beside it, as wrapping there can make the header
 * taller. The row is narrow below about twice the controls' width with their
 * gap: there a title too long to fit beside them takes at least one more line
 * beside them than across the row, the line the controls take under it.
 * Decided by CSS alone, so nothing moves once the page has loaded. Under the
 * title the star's padding goes past the row's edge, so the star lines up
 * with the title; beside it the wider gap gives the padding back.
 */
export function DetailTitleRow({
  title,
  wideControls = false,
  children,
}: {
  title: ReactNode;
  /** The book's controls (the favourite, collection, copy, Export and the menu), about 300px on touch */
  wideControls?: boolean;
  /** The controls, the favourite first */
  children: ReactNode;
}) {
  return (
    <div className="@container">
      <div className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW[wideControls ? "wide" : "standard"]}`}>
        <h1 className="type-page-title min-w-0 flex-[1_1_auto] break-words">{title}</h1>
        <CapAlignedControls height={32} coarseHeight={44} className="type-page-title -ml-2 pointer-coarse:-ml-3.5">
          {children}
        </CapAlignedControls>
      </div>
    </div>
  );
}
