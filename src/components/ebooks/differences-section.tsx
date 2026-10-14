"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SectionHeading } from "@/components/shared/section-heading";
import { CardHeading } from "@/components/shared/card-heading";
import { Button, buttonClass } from "@/components/ui/button";
import { WorkReviewDialog } from "@/components/ebooks/work-review-dialog";
import { decideEbookDifferences, undoEbookDifferences } from "@/lib/actions/ebook-differences";
import { DIFFERENCE_FIELDS, DIFFERENCE_LABELS, fieldWord, type Difference, type DifferenceField } from "@/lib/ebooks/differences/compare";
import type { DifferenceOutcome, DifferencesPage } from "@/lib/ebooks/differences/store";
import { languageName } from "@/lib/utils/language";

type Choice = "keep" | "use";
const CHOICES: Record<Choice, string> = { keep: "Keep Durtal's", use: "Use the file's" };
const key = (d: Pick<Difference, "ebookId" | "field">) => `${d.ebookId}:${d.field}`;
const value = (d: Difference, side: string | null) => {
  if (side === null) return "None";
  return d.field === "language" ? (languageName(side) ?? side) : side;
};

/**
 * The Differences section of /ebooks/review (SLN-658): where a library
 * e-book and its book disagree, both values side by side, field by field,
 * with the two choices per row or for every row shown, and an undo for each.
 */
export function DifferencesSection({ page, step, links, moreHref }: {
  page: DifferencesPage;
  /** Rows a "Show more" adds */
  step: number;
  links: Partial<Record<DifferenceField, string>>;
  moreHref: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<{ id: string; label: string; outcomes: DifferenceOutcome[] }[]>([]);
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [work, setWork] = useState<{ id: string; title: string; status: string } | null>(null);
  const lock = useRef(false);
  if (!page.total) return null;
  const rows = page.rows.filter((d) => !done.has(key(d)));
  const bulk = (choice: Choice) => rows.filter((d) => (choice === "keep" ? d.keep : d.use));

  async function decide(choice: Choice, items: Difference[], label: string) {
    if (lock.current || !items.length) return;
    lock.current = true; setBusy(true); setNotice(null); setConfirming(null);
    const result = await decideEbookDifferences({ choice, items: items.map(({ ebookId, field, durtal, file }) => ({ ebookId, field, durtal, file })) })
      .catch(() => null);
    lock.current = false; setBusy(false);
    if (!result?.ok) { setNotice(result?.message ?? "The outcome could not be confirmed. Reload to see what was saved."); return; }
    const { done: outcomes, refused } = result.value;
    setDone((existing) => new Set([...existing, ...outcomes.map(key)]));
    setErrors((existing) => ({ ...Object.fromEntries(Object.entries(existing).filter(([k]) => !outcomes.some((o) => key(o) === k))),
      ...Object.fromEntries(refused.map((r) => [key(r), r.message])) }));
    if (outcomes.length) setRuns((existing) => [{ id: outcomes[0].eventId, label, outcomes }, ...existing]);
    setNotice(outcomes.length === 1 ? outcomes[0].message
      : `${outcomes.length} choices saved${refused.length ? `; ${refused.length} not, shown on their rows` : ""}.`);
    router.refresh();
  }
  async function undo(run: { id: string; outcomes: DifferenceOutcome[] }) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(null);
    const result = await undoEbookDifferences({ eventIds: run.outcomes.map((o) => o.eventId) }).catch(() => null);
    lock.current = false; setBusy(false);
    if (!result?.ok) { setNotice(result?.message ?? "The undo could not be confirmed. Reload to see what was saved."); return; }
    const undone = new Set(result.value.done.map((d) => d.eventId));
    const left = run.outcomes.filter((o) => !undone.has(o.eventId));
    setRuns((existing) => existing.flatMap((r) => (r.id !== run.id ? [r] : left.length ? [{ ...r, outcomes: left }] : [])));
    setDone((existing) => new Set([...existing].filter((k) => !run.outcomes.some((o) => undone.has(o.eventId) && key(o) === k))));
    setNotice(result.value.refused.length ? result.value.refused[0].message
      : undone.size === 1 ? result.value.done[0].message : `${undone.size} choices undone.`);
    router.refresh();
  }

  const field = page.field;
  const keepAll = bulk("keep"), useAll = bulk("use");
  return <section aria-labelledby="review-section-differences" className="space-y-3">
    <SectionHeading id="review-section-differences" title="Differences" count={page.total}
      description="Where an e-book and its book disagree. Keep Durtal's sets the e-book's own field; Use the file's changes the book. Every choice can be undone." />
    <nav aria-label="Differences by field" className="flex flex-wrap gap-2">
      {DIFFERENCE_FIELDS.filter((f) => page.counts[f]).map((f) => <Link key={f} href={links[f] ?? "#"} scroll={false}
        aria-current={f === field ? "page" : undefined} className={buttonClass(f === field ? "secondary" : "ghost", "sm")}>
        {DIFFERENCE_LABELS[f]} <span className="text-fg-secondary">{page.counts[f]!.toLocaleString()}</span>
      </Link>)}
    </nav>
    {(keepAll.length > 1 || useAll.length > 1) && <div className="flex flex-wrap items-center gap-2">
      {confirming ? <>
        <p className="text-sm">{CHOICES[confirming]} for the {bulk(confirming).length} rows shown?</p>
        <Button size="sm" variant="primary" disabled={busy}
          onClick={() => void decide(confirming, bulk(confirming), `${CHOICES[confirming]} · ${bulk(confirming).length} ${fieldWord(field!)} rows`)}>
          {busy ? "Saving…" : "Confirm"}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>Cancel</Button>
      </> : <>
        {keepAll.length > 1 && <Button size="sm" disabled={busy} onClick={() => setConfirming("keep")}>Keep Durtal's for these {keepAll.length}…</Button>}
        {useAll.length > 1 && <Button size="sm" disabled={busy} onClick={() => setConfirming("use")}>Use the file's for these {useAll.length}…</Button>}
      </>}
    </div>}
    {notice && <p role="status" className="text-sm text-fg-secondary">{notice}</p>}
    {rows.map((d) => <article key={key(d)} data-difference-row={key(d)} className="card-body rounded-sm border border-glass-border bg-bg-secondary/70 p-4">
      <div className="flex items-start gap-3">
        {d.ebookCover && <Image src={`/api/reader/${d.ebookId}/cover?w=240`} width={60} height={88} alt="" unoptimized
          loading="lazy" className="h-22 w-15 shrink-0 rounded-sm object-cover" />}
        <div className="min-w-0 flex-1">
          <CardHeading title={d.slug ? <a href={`/library/${d.slug}`}>{d.bookTitle}</a> : d.bookTitle} subtitle={DIFFERENCE_LABELS[d.field]} />
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="type-label">Durtal</dt><dd className="mt-1 [overflow-wrap:anywhere]">{value(d, d.durtal)}</dd></div>
            <div className="min-w-0"><dt className="type-label">File</dt><dd className="mt-1 [overflow-wrap:anywhere]">{value(d, d.file)}</dd></div>
          </dl>
          {d.note && <p className="mt-2 text-xs text-fg-secondary">{d.note}</p>}
          {!d.use && d.why && <p className="mt-2 text-xs text-fg-secondary">{d.why}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {d.field === "status"
              ? <Button size="sm" disabled={busy} onClick={() => setWork({ id: d.workId, title: d.bookTitle, status: d.durtal === "Wanted" ? "wanted" : "on_order" })}>Mark accessioned…</Button>
              : <>
                {d.keep && <Button size="sm" disabled={busy} onClick={() => void decide("keep", [d], `${CHOICES.keep} · ${d.bookTitle}`)}>{CHOICES.keep}</Button>}
                {d.use && <Button size="sm" disabled={busy} onClick={() => void decide("use", [d], `${CHOICES.use} · ${d.bookTitle}`)}>{CHOICES.use}</Button>}
              </>}
          </div>
          {errors[key(d)] && <p role="alert" className="mt-2 text-sm text-accent-red-text">{errors[key(d)]}</p>}
        </div>
      </div>
    </article>)}
    {moreHref && <Link href={moreHref} scroll={false} className={buttonClass("secondary", "sm")}>Show {step} more</Link>}
    {runs.length > 0 && <div className="space-y-2">
      <h3 className="type-item-title">Recent choices</h3>
      {runs.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-glass-border px-3 py-2">
        <p className="min-w-0 text-sm [overflow-wrap:anywhere]">{run.label}</p>
        <Button size="sm" disabled={busy} onClick={() => void undo(run)}>{run.outcomes.length > 1 ? `Undo all ${run.outcomes.length}` : "Undo"}</Button>
      </div>)}
    </div>}
    {work && <WorkReviewDialog work={work} onClose={() => setWork(null)}
      onCommitted={(outcome) => { setNotice(outcome.message); router.refresh(); }}
      onUndone={(outcome) => { setNotice(outcome.message); router.refresh(); }} />}
  </section>;
}
