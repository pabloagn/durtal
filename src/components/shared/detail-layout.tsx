import type { ReactNode } from "react";
import Link from "next/link";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { editTooltipKeys } from "@/lib/shortcuts/shortcuts";

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

/**
 * The row's classes: when the controls may go under the title, and the
 * title-to-controls gap (the gap less the star's pulled-out padding).
 *
 * Wrapping can make a header taller: a title too long for one line across
 * the row takes a line for the controls under it as well. Below about twice
 * the controls' width with their gap, a title that wraps beside them takes
 * at least one more line than across the row, so wrapping there is never
 * taller; in a wider row a long title can be shorter either way. Each kind
 * takes the rule that, measured with long and short titles, grows its
 * header least.
 */
export const DETAIL_TITLE_ROW = {
  // The publisher's star, Edit and menu (157px on touch): 16px from the
  // title; under it below a 24rem row
  standard: "gap-x-6 pointer-coarse:gap-x-7.5 @min-[24rem]:flex-nowrap",
  // The book's set (249px, 297px on touch), and the favourite, Edit and
  // menu of a person, painting, perfume, organization and place: 12px from
  // the title; under it below a 33rem row, 39rem on touch. For those five
  // it is never taller than `free`, and a line shorter where a long title
  // fits beside the set (1024 and up, the painting's column at 1440)
  wide: "gap-x-5 pointer-coarse:gap-x-6.5 not-pointer-coarse:@min-[33rem]:flex-nowrap pointer-coarse:@min-[39rem]:flex-nowrap",
  // A film's set: under a title too long for it below sm, where the header
  // stacks over its poster
  stacked: "gap-x-5 pointer-coarse:gap-x-6.5 sm:flex-nowrap",
  // A series' set: under any title too long for it
  free: "gap-x-5 pointer-coarse:gap-x-6.5",
};

/**
 * The title row of a detail page's header: the h1 and its controls, in
 * `DetailControls`, on the cap-height center of the title's first line.
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
/** Past 40 letters a title is 38px on a phone, past 60 it is 30px; shorter titles keep 46px */
export const LONG_TITLE = 40, LONGER_TITLE = 60;

export function DetailTitleRow({
  title,
  controls = "standard",
  children,
}: {
  title: ReactNode;
  /** How wide the controls are (DETAIL_TITLE_ROW) */
  controls?: keyof typeof DETAIL_TITLE_ROW;
  /** `DetailControls`, or a component that renders them */
  children: ReactNode;
}) {
  // On a phone a long title steps down the type scale (globals.css), so it
  // keeps to three or four lines and the page's picture stays near the top
  const length = typeof title === "string" ? title.length : 0;
  const titleLength = length > LONGER_TITLE ? "longer" : length > LONG_TITLE ? "long" : undefined;
  return (
    <div className="@container">
      <div data-title-length={titleLength} className={`type-page-title flex flex-wrap items-start ${DETAIL_TITLE_ROW[controls]}`}>
        <h1 data-title-length={titleLength} className="type-page-title min-w-0 flex-[1_1_auto] break-words">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * A detail header's controls, the favourite (or the first icon button)
 * first: 32px, 44px on touch. Pulled left by the first button's padding, so
 * under a wrapped title its icon lines up with the title's edge.
 */
export function DetailControls({ children }: { children: ReactNode }) {
  return (
    <CapAlignedControls height={32} coarseHeight={44} className="type-page-title -ml-2 pointer-coarse:-ml-3.5">
      {children}
    </CapAlignedControls>
  );
}

const EDIT_BUTTON =
  "inline-flex h-8 items-center rounded-sm border border-glass-border px-3 text-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11";

/**
 * A detail header's labelled Edit, between the favourite and the Actions
 * menu: the same set on every kind (SLN-641). A link to an editor page, or
 * a button that opens the edit dialog; its tooltip names the item and the
 * E then letter key that does the same.
 */
export function DetailEditButton({
  label,
  editKey,
  href,
  onClick,
}: {
  /** The tooltip: "Edit film" */
  label: string;
  /** The letter after E (`EDIT_KEYS`) */
  editKey: string;
  href?: string;
  onClick?: () => void;
}) {
  const tooltip = { "data-tooltip": label, "data-tooltip-keys": editTooltipKeys(editKey) };
  return href ? (
    <Link href={href} {...tooltip} className={EDIT_BUTTON}>
      Edit
    </Link>
  ) : (
    <button type="button" onClick={onClick} {...tooltip} className={EDIT_BUTTON}>
      Edit
    </button>
  );
}
