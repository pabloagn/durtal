import Link from "next/link";
import { Sparkles } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/shared/section-heading";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { Cover } from "@/components/reading/reading-tiles";
import { SuggestionList } from "@/components/reading/suggestions/suggestion-list";
import { SuggestionConstraints } from "@/components/reading/suggestions/suggestion-constraints";
import { PickOne } from "@/components/reading/suggestions/pick-one";
import { HiddenList, type HiddenRow } from "@/components/reading/suggestions/hidden-list";
import { StartAgainButton } from "@/components/reading/suggestions/start-again";
import { FEEDBACK_REASON_LABELS } from "@/lib/reading/constants";
import { formatReadingDate } from "@/lib/reading/dates";
import { storedHomeId } from "@/lib/reading/home-cookie";
import { bookEdition } from "@/lib/reading/suggest/build";
import { getSuggestionContext } from "@/lib/reading/suggest/context";
import { SUGGESTIONS_PER_PAGE, parseSuggestionParams, suggestionQuery } from "@/lib/reading/suggest/params";
import { worthRereading } from "@/lib/reading/suggest/rereads";
import { candidates, hiddenByFeedback, pausedAuthors, suggest } from "@/lib/reading/suggest/score";
import { suggestionRow } from "@/lib/reading/suggest/view";
import { languageName } from "@/lib/utils/language";

export const metadata = { title: "Suggestions" };

const n = (v: number) => v.toLocaleString("en-US");

/*
 * Suggestions (SLN-457): what to read next from his own catalogue and
 * history, each with its reasons, Why this?, and Not now, Never and Not for
 * me. Computed per request, never cached. `?view=hidden` lists what he hid.
 */
export default async function SuggestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { params } = parseSuggestionParams(await searchParams);
  const ctx = await getSuggestionContext({ homeId: await storedHomeId() });
  const day = (d: string) => formatReadingDate(d, "day", { omitYear: d.slice(0, 4) === ctx.today.slice(0, 4) });

  const hidden = ctx.books
    .filter((b) => b.finishedCount === 0 && b.feedback && hiddenByFeedback(b, ctx.today))
    .sort((a, b) => b.feedback!.updatedAt.localeCompare(a.feedback!.updatedAt));
  const hiddenLink = (
    <Link
      href={`/reading/suggestions${suggestionQuery({ ...params, page: 1, pick: undefined, view: params.view ? undefined : "hidden" })}`}
      className="text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      data-suggestions-view=""
    >
      {params.view ? "Back to suggestions" : `Hidden (${n(hidden.length)})`}
    </Link>
  );

  if (params.view === "hidden") {
    const rows: HiddenRow[] = hidden.map((b) => {
      const f = b.feedback!;
      const verdict =
        f.verdict === "not_now" ? `Not now, until ${day(f.until!)}` : f.verdict === "never" ? "Never" : `Not for me: ${f.reasons.map((r) => FEEDBACK_REASON_LABELS[r]).join(", ")}`;
      return {
        workId: b.id,
        title: b.title,
        href: `/library/${b.slug ?? b.id}`,
        author: b.authors[0]?.name ?? null,
        cover: bookEdition(b, ctx)?.thumbnail ?? b.cover ?? b.editions.find((e) => e.thumbnail)?.thumbnail ?? null,
        verdict,
        note: f.note,
        date: `Hidden on ${day(f.updatedAt.slice(0, 10))}`,
      };
    });
    return (
      <>
        <PageHeader title="Reading" tabs={<ReadingTabs />} />
        <SectionHeading title="Hidden from suggestions" count={rows.length} action={hiddenLink} />
        {rows.length ? <HiddenList rows={rows} /> : <p className="text-sm text-fg-secondary">Nothing is hidden. Not now, Never and Not for me show here, each with Undo.</p>}
      </>
    );
  }

  const list = suggest(ctx, params);
  const pages = Math.max(1, Math.ceil(list.length / SUGGESTIONS_PER_PAGE));
  const page = Math.min(params.page, pages);
  const rows = list.slice((page - 1) * SUGGESTIONS_PER_PAGE, page * SUGGESTIONS_PER_PAGE).map((s) => suggestionRow(s, ctx));
  const top = list.slice(0, 10).map((s) => suggestionRow(s, ctx));
  const pool = candidates(ctx);
  const languages = [...new Set(pool.map((b) => bookEdition(b, ctx)?.language).filter((l): l is string => !!l))]
    .map((code) => ({ value: code, label: languageName(code) ?? code }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const workTypes = [...new Map(pool.flatMap((b) => b.terms.filter((t) => t.key.startsWith("wt:")).map((t) => [t.key.slice(3), t.name] as const))).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const unreadRated = ctx.books.filter((b) => b.rating !== null && !b.hasReading).length;
  const paused = [...pausedAuthors(ctx).values()];
  const rereads = worthRereading(ctx).slice(0, 6);
  const pageHref = (p: number) => `/reading/suggestions${suggestionQuery({ ...params, page: p, pick: undefined })}`;

  return (
    <>
      <PageHeader title="Reading" actions={<PickOne top={top} initiallyOpen={!!params.pick} />} tabs={<ReadingTabs />} />
      <SuggestionConstraints params={params} languages={languages} homes={ctx.homes.map((h) => ({ value: h.id, label: h.name }))} workTypes={workTypes} />
      <div className="mb-6 space-y-1 text-xs text-fg-secondary">
        {unreadRated > 0 && (
          <p data-suggestions-rated="">
            <Link href="/library?reading=unread&rating=0.5" className="underline-offset-2 hover:text-fg-primary hover:underline">
              {n(unreadRated)} rated {unreadRated === 1 ? "book has" : "books have"} no reading
            </Link>
            : mark them read to use their ratings.
          </p>
        )}
        {paused.map((a) => (
          <p key={a.name} data-suggestions-paused="">
            {a.name} is paused until {day(a.until)}, after two Not for me in a month.
          </p>
        ))}
      </div>

      <div className="space-y-12">
        <section id="list-start" className="scroll-mt-24">
          <SectionHeading title="Read next" count={list.length} action={hiddenLink} />
          {rows.length ? (
            <>
              <SuggestionList rows={rows} />
              {pages > 1 && (
                <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm" data-suggestions-pages="">
                  {page > 1 ? (
                    <Link href={pageHref(page - 1)} className="text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:py-3">
                      Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-fg-secondary tabular-nums">
                    Page {page} of {pages}
                  </span>
                  {page < pages ? (
                    <Link href={pageHref(page + 1)} className="text-fg-secondary transition-colors hover:text-fg-primary pointer-coarse:py-3">
                      Next
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              )}
            </>
          ) : (
            <EmptyState
              icon={Sparkles}
              title={pool.length ? "Nothing matches these constraints" : "Nothing to suggest yet"}
              description={pool.length ? "Widen the length, the language or the scope." : "Books you own and have not read show here, with their reasons."}
              action={
                <Link href={pool.length ? "/reading/suggestions" : "/library"} className={`${buttonClass("secondary")} pointer-coarse:h-11`}>
                  {pool.length ? "Clear the constraints" : "Go to your library"}
                </Link>
              }
            />
          )}
        </section>

        {rereads.length > 0 && (
          <section data-suggestions-rereads="">
            <SectionHeading title="Worth re-reading" />
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rereads.map(({ book, text }) => (
                <li key={book.id} className="flex items-start gap-3" data-reread={book.id}>
                  <Link href={`/library/${book.slug ?? book.id}`} tabIndex={-1} aria-label={book.title} className="shrink-0">
                    <Cover s3Key={bookEdition(book, ctx)?.thumbnail ?? book.cover ?? book.editions.find((e) => e.thumbnail)?.thumbnail ?? null} className="h-16 w-11" />
                  </Link>
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm text-fg-primary">{text}</p>
                    <StartAgainButton workId={book.id} editionId={bookEdition(book, ctx)?.id ?? null} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
