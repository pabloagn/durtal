"use client";

import Image from "next/image";
import { ChevronDown, Unlink } from "lucide-react";

import { CardHeading } from "@/components/shared/card-heading";
import { Button, buttonClass } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { languageName } from "@/lib/utils/language";
import { catalogueStatusLabel } from "@/lib/utils/labels";
import { formatBytes } from "@/lib/ebooks/run-text";
import type { ReviewDetail, ReviewOutcome, ReviewQueueRow, ReviewSectionKey } from "@/lib/ebooks/review-queue/types";
import type { ReviewUnlinkMode } from "@/lib/ebooks/review-queue/unlink-types";
import { shortcutProps } from "@/lib/shortcuts/shortcuts";

export type ReviewRowAction = "accept" | "choose" | "new" | "keep" | "exclude" | "rematch";
const flags: Record<string, string> = { omnibus: "Omnibus", sample: "Sample", periodical: "Periodical",
  article: "Article", shared_isbn: "ISBN shared by more than one book" };
const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;
const choices: { action: Exclude<ReviewRowAction, "accept">; label: string; key?: string }[] = [
  { action: "choose", label: "Choose a book…", key: "c" }, { action: "new", label: "New book", key: "n" },
  { action: "keep", label: "Keep as eBook", key: "e" }, { action: "exclude", label: "Set aside", key: "x" },
  { action: "rematch", label: "Match again" },
];
/**
 * The one choice a row recommends (SLN-684): what its section says it most
 * likely is. Accept means its proposed book; the other choices sit in a menu.
 */
export function recommendedAction(section: ReviewSectionKey | undefined, row: ReviewQueueRow): ReviewRowAction {
  if (section === "duplicate" || section === "not_a_book") return "exclude";
  if (section === "not_in_durtal") return "keep";
  return row.candidates.length > 0 ? "accept" : "choose";
}
export function ReviewRow({ row, section, detail, selected, focused, busy, returnTo, error, outcome,
  onSelect, onFocus, onAction, onUndo, onWorkStatus, onUnlink }: {
  row: ReviewQueueRow; section?: ReviewSectionKey; detail?: ReviewDetail; selected: boolean; focused: boolean; busy: boolean;
  returnTo: string; error?: string; outcome?: ReviewOutcome;
  onSelect: (selected: boolean) => void; onFocus: () => void;
  onAction: (action: ReviewRowAction, rank?: number) => void; onUndo: () => void;
  onWorkStatus?: () => void;
  onUnlink?: (mode: ReviewUnlinkMode) => void;
}) {
  const pending = row.state === "pending";
  const decisionDisabled = busy || !row.stamp;
  const native = row.files.some((file) => file.availability === "native");
  const recommended = recommendedAction(section, row);
  const primary = choices.find((choice) => choice.action === recommended);
  const others = choices.filter((choice) => choice !== primary);
  return <article tabIndex={0} data-review-row={row.id} onFocus={onFocus}
    className={`rounded-sm border bg-bg-secondary/70 p-4 outline-none focus-visible:glass-input-focus ${focused ? "border-accent-primary/50" : "border-glass-border"}`}>
    <div className="grid gap-5 sm:grid-cols-2 sm:gap-6">
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          {row.hasCover && <Image src={`/api/reader/${row.id}/cover?w=240`} width={60} height={88} alt="" unoptimized
            loading="lazy" className="h-22 w-15 shrink-0 rounded-sm object-cover" />}
          <div className="min-w-0 flex-1"><CardHeading title={row.title} subtitle={row.subtitle ?? row.authors.join(" & ")}
            action={<label className="inline-flex h-8 w-8 items-center justify-center pointer-coarse:h-11 pointer-coarse:w-11">
              <input type="checkbox" checked={selected} disabled={!pending || !row.stamp || busy}
                aria-label={`Select ${row.title}`} onChange={(event) => onSelect(event.target.checked)} />
            </label>} />
            {row.subtitle && <p className="mt-1 text-sm text-fg-secondary">{row.authors.join(" & ")}</p>}
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-fg-secondary">{[
          row.language ? languageName(row.language) : "Language unknown",
          row.series ? `${row.series}${row.seriesIndex ? ` · ${row.seriesIndex}` : ""}` : null,
          row.publisher, row.year,
        ].filter((value) => value !== null && value !== "").join(" · ")}</p>
        {row.isbns.length > 0 && <ul className="mt-2 space-y-1 text-xs text-fg-secondary">
          {row.isbns.map((isbn) => <li key={isbn}>ISBN {isbn} <span>· valid</span></li>)}
        </ul>}
        {Object.keys(row.identifiers).length > 0 && <details className="mt-2 text-xs text-fg-secondary">
          <summary className="cursor-pointer pointer-coarse:py-3.5">Other identifiers</summary>
          <dl className="mt-1 space-y-1">{Object.entries(row.identifiers).map(([provider, values]) =>
            <div key={provider} className="flex flex-wrap gap-x-2"><dt>{provider}</dt><dd className="[overflow-wrap:anywhere]">{values.join(", ")}</dd></div>)}</dl>
        </details>}
        <ul className="mt-3 space-y-1.5 text-xs">
          {row.files.map((file) => <li key={file.id} className="flex flex-wrap gap-x-2 text-fg-secondary"
            data-tooltip={[file.checksum, file.sourcePath].filter(Boolean).join(" · ")}>
            <span className="font-medium text-fg-primary">{file.format.toUpperCase()}</span>
            <span>{formatBytes(file.sizeBytes)}</span>
            <span>{file.availability === "native" ? "Ready to read" : file.availability === "download" ? "Download available" : file.drm ? "Protected file" : file.status}</span>
          </li>)}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {native && <ReaderEntryLink readerPath={`/reader/${row.id}`} returnTo={returnTo} data-review-open={row.id}
            {...shortcutProps("o")} className={buttonClass("secondary", "sm")}>Open</ReaderEntryLink>}
          <a href={`/ebooks/${row.id}`} className={buttonClass("secondary", "sm")}>eBook details</a>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        {row.duplicate && <p className="text-sm text-fg-secondary">Same book as <a className="underline underline-offset-2" href={`/ebooks/${row.duplicate.id}`}>{row.duplicate.title}</a>.</p>}
        {row.work && <p className="text-sm">Linked to <a className="underline underline-offset-2" href={`/library/${row.work.slug}`}>{row.work.title}</a>
          <span className="text-fg-secondary"> · {catalogueStatusLabel(row.work.status)}</span></p>}
        {row.candidates.map((candidate, index) => {
          const actual = detail?.candidates.find((item) => item.rank === candidate.rank && item.workId === candidate.workId);
          return <div key={candidate.rank} className={index ? "border-t border-glass-border pt-3" : ""}>
            <p className="type-label mb-1">{index ? `Other candidate ${candidate.rank}` : "Proposed book"}</p>
            <CardHeading title={<a href={`/library/${candidate.slug}`}>{candidate.title}</a>} subtitle={candidate.authors.join(" & ")} />
            <p className="mt-1 text-xs text-fg-secondary">{[
              candidate.language ? languageName(candidate.language) : null, candidate.year,
              catalogueStatusLabel(candidate.status), `${(candidate.probability * 100).toFixed(1)}%`,
            ].filter((value) => value !== null).join(" · ")}</p>
            <ul className="mt-2 space-y-1 text-xs text-fg-secondary">{candidate.reasons.map((reason, reasonIndex) => <li key={`${reason.code}:${reasonIndex}`}>{reason.text}</li>)}</ul>
            {candidate.flags.length > 0 && <p className="mt-1 text-xs text-fg-secondary">{candidate.flags.map((flag) => flags[flag] ?? flag.replaceAll("_", " ")).join(" · ")}</p>}
            {candidate.rule === "fill_copy" && <p className="mt-2 text-xs">Has a digital copy waiting for its file.</p>}
            {actual && <p className="mt-2 text-sm">{actual.effectText}</p>}
            <details className="mt-2 text-xs text-fg-secondary"><summary className="cursor-pointer pointer-coarse:py-3.5">{plural(candidate.editionCount, "edition", "editions")}</summary>
              <ul className="mt-1 space-y-1">{candidate.editions.map((edition) => <li key={edition.id}>{[
                edition.placeholder ? "Edition not identified" : edition.title, edition.language, edition.isbn13,
                edition.publisher, edition.year, plural(edition.copyCount, "copy", "copies"),
              ].filter((value) => value !== null).join(" · ")}</li>)}</ul>
              {candidate.editionCount > candidate.editions.length && <p className="mt-1">Showing the first {candidate.editions.length}. Open the book to see all editions.</p>}
            </details>
            {pending && <Button className="mt-2" size="sm" variant={!index && recommended === "accept" ? "primary" : "secondary"}
              disabled={decisionDisabled || (actual !== undefined && !actual.eligible)} {...shortcutProps(index ? undefined : "a")}
              onClick={() => onAction("accept", candidate.rank)}>Review this match</Button>}
          </div>;
        })}
        {pending && <div className="flex flex-wrap gap-2 border-t border-glass-border pt-3">
          {primary && <Button size="sm" variant="primary" onClick={() => onAction(primary.action)} disabled={decisionDisabled}
            {...shortcutProps(primary.key)}>{primary.label}</Button>}
          <DropdownMenu align="start" trigger={<button type="button" disabled={decisionDisabled} data-review-choices={row.id}
            className={buttonClass("secondary", "sm")}>Other choices<ChevronDown aria-hidden className="h-4 w-4" strokeWidth={1.5} /></button>}>
            {others.map((choice) => <DropdownMenuItem key={choice.action} disabled={decisionDisabled}
              shortcut={choice.key} onClick={() => onAction(choice.action)}>{choice.label}</DropdownMenuItem>)}
          </DropdownMenu>
        </div>}
        {outcome?.undo.available && <Button size="sm" onClick={onUndo} disabled={busy}>Undo decision</Button>}
        {onWorkStatus && row.state === "linked" && row.work && ["tracked", "shortlisted", "wanted", "on_order"].includes(row.work.status) &&
          <Button size="sm" onClick={onWorkStatus} disabled={busy}>Mark book accessioned…</Button>}
        {onUnlink && row.state === "linked" && row.matching && <div className="flex flex-wrap gap-2">
          {row.matching.automatic && <Button size="sm" disabled={decisionDisabled} onClick={() => onUnlink("automatic_undo")}>Undo automatic link…</Button>}
          <Button size="sm" variant="ghost" disabled={decisionDisabled} onClick={() => onUnlink("unlink")}><Unlink aria-hidden strokeWidth={1.5} />Unlink…</Button>
        </div>}
        {row.state === "linked" && !row.matching && <p className="text-xs text-fg-secondary">The stored matching operation cannot be verified for Unlink.</p>}
        {!row.stamp && <p role="alert" className="text-xs text-accent-red-text">This row has an invalid review timestamp. Its decisions are unavailable.</p>}
        {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      </div>
    </div>
  </article>;
}
