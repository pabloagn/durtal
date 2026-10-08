import Link from "next/link";
import type { ReactNode } from "react";
import { SectionHeading } from "@/components/shared/section-heading";
import { n } from "@/lib/reading/charts";

/*
 * The stats pages' plain parts (SLN-456): number tiles, ranked lists with a
 * thin bar (text first, the bar only shows the share), and footnotes.
 */

export function StatsSection({ title, id, children, action }: { title: string; id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24" data-stats-section={id}>
      <SectionHeading title={title} action={action} />
      <div className="space-y-6">{children}</div>
    </section>
  );
}

export function NumberTiles({ tiles }: { tiles: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-stats-numbers="">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-sm border border-glass-border bg-bg-secondary px-4 py-4">
          <dd className="type-stat text-fg-primary tabular-nums">{t.value}</dd>
          <dt className="mt-1 text-xs text-fg-secondary">{t.label}</dt>
        </div>
      ))}
    </dl>
  );
}

export interface RankItem {
  label: string;
  href?: string;
  value: number;
  /** What the row says on the right: "4 books", "1,210 pages" */
  text: string;
}

/** A ranked list: the label (a link when there is a page), its number, and a thin bar for its share */
export function RankList({ title, items }: { title?: string; items: RankItem[] }) {
  if (!items.length) return null;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="min-w-0">
      {title && <SectionHeading as="h3" title={title} />}
      {/* On touch the rows are 44px apart, so the links' press areas do not overlap */}
      <ol className="space-y-2 pointer-coarse:space-y-3">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {item.href ? (
                // The label cuts off inside the link: the link's touch area is not clipped
                <Link href={item.href} className="min-w-0 text-fg-primary transition-colors hover:text-accent-primary touch-hit">
                  <span className="lines-1">{item.label}</span>
                </Link>
              ) : (
                <span className="lines-1 min-w-0 text-fg-primary">{item.label}</span>
              )}
              <span className="shrink-0 text-xs text-fg-secondary tabular-nums">{item.text}</span>
            </div>
            <div className="mt-1 h-1 rounded-sm bg-bg-tertiary" aria-hidden>
              <div className="h-full rounded-sm bg-accent-sage/70" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-fg-secondary">{children}</p>;
}

/** "3 audiobooks are not counted in pages" */
export function audioNote(count: number) {
  return count ? `${count} ${count === 1 ? "audiobook is" : "audiobooks are"} not counted in pages.` : null;
}

/** People linking to their pages, at most `max`, then "and 273 more": a year of hundreds of new authors stays within the page budget */
export function NameList({ people, max = 24 }: { people: { authorId: string; name: string; slug: string }[]; max?: number }) {
  return (
    <>
      {people.slice(0, max).map((a, i) => (
        <span key={a.authorId}>
          {i > 0 && ", "}
          <Link href={`/people/${a.slug}`} className="text-fg-primary transition-colors hover:text-accent-primary">
            {a.name}
          </Link>
        </span>
      ))}
      {people.length > max && `, and ${n(people.length - max)} more`}
    </>
  );
}
