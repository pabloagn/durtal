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

export interface NumberTile {
  label: string;
  value: string;
  /** What a screen reader says for a value drawn as a dash */
  spoken?: string;
}

/**
 * The Hours tile: a dash when no session had a duration, as 0 pages is a
 * dash, and "Under 1" for minutes only (SLN-1173). "0" beside 350 finished
 * books read as no time spent, not as none recorded.
 */
export function hoursTile(hours: number): NumberTile {
  if (!(hours > 0)) return { label: "Hours", value: "—", spoken: "Not timed" };
  return { label: "Hours", value: hours < 0.5 ? "Under 1" : n(hours) };
}

export function NumberTiles({ tiles }: { tiles: NumberTile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-stats-numbers="">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-sm border border-glass-border bg-bg-secondary px-4 py-4">
          <dd className="type-stat text-fg-primary tabular-nums">
            {t.spoken ? (
              <>
                <span aria-hidden="true">{t.value}</span>
                <span className="sr-only">{t.spoken}</span>
              </>
            ) : (
              t.value
            )}
          </dd>
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

const RANK_TONES = { sage: "bg-accent-sage/70", blue: "bg-accent-blue/70", gold: "bg-accent-gold/70" } as const;

/** A ranked list: the label (a link when there is a page), its number, and a thin bar for its share */
export function RankList({ title, items, tone = "sage" }: { title?: string; items: RankItem[]; tone?: keyof typeof RANK_TONES }) {
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
                // A text command (SLN-1195): in the text colour it read as a plain label.
                // Its ink only: the rows' 44px pitch gives the press area
                <Link href={item.href} className="min-w-0 text-command-ink touch-hit">
                  <span className="lines-1">{item.label}</span>
                </Link>
              ) : (
                <span className="lines-1 min-w-0 text-fg-primary">{item.label}</span>
              )}
              <span className="shrink-0 text-xs text-fg-secondary tabular-nums">{item.text}</span>
            </div>
            <div className="mt-1 h-1 rounded-sm bg-bg-tertiary" aria-hidden>
              <div className={`h-full rounded-sm ${RANK_TONES[tone]}`} style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
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
          <Link href={`/people/${a.slug}`} className="text-command">
            {a.name}
          </Link>
        </span>
      ))}
      {people.length > max && `, and ${n(people.length - max)} more`}
    </>
  );
}
