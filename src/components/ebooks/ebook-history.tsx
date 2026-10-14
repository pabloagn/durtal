import Link from "next/link";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
import type { EbookDecision } from "@/lib/ebooks/review/history";
import { effectWords } from "@/lib/ebooks/review/effect-line";
import { SectionHeading } from "@/components/shared/section-heading";

/** What a review decision did, as a History line (SLN-684) */
const DECISIONS: Record<string, string> = {
  accept: "Linked to its book", link: "Linked to its book", accession: "Added as a new book",
  keep: "Kept as an eBook", exclude: "Set aside", rematch: "Matched again",
  restore: "Returned to review", unlink: "Unlinked", undo: "Decision undone",
};
type Item =
  | { kind: "ingest"; at: string; entry: EbookDetail["history"][number] }
  | { kind: "decision"; at: string; entry: EbookDecision };
const day = (at: string) => new Date(at).toISOString().slice(0, 10);

/**
 * The eBook's History: the ingestion runs that saw its files and the review
 * decisions on it, newest first.
 */
export function EbookHistory({ ebook, decisions, decisionTotal }: {
  ebook: Pick<EbookDetail, "history" | "historyTotal">; decisions: EbookDecision[]; decisionTotal: number;
}) {
  const items: Item[] = [
    ...ebook.history.map((entry) => ({ kind: "ingest" as const, at: entry.createdAt, entry })),
    ...decisions.map((entry) => ({ kind: "decision" as const, at: entry.createdAt, entry })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const total = ebook.historyTotal + decisionTotal;
  return <>
    <SectionHeading title="History" count={total} />
    {items.length ? (
      <ul className="divide-y divide-glass-border">
        {items.map((item) => item.kind === "ingest" ? (
          <li key={`run-${item.entry.id}`} className="py-3 text-sm">
            <Link href={`/ebooks/runs/${item.entry.runId}`} className="text-accent-primary">
              {day(item.at)} · {item.entry.host ?? "Browser upload"}
            </Link>
            <p className="mt-1 text-xs text-fg-secondary [overflow-wrap:anywhere]">
              {item.entry.path} · {item.entry.reason ?? item.entry.outcome?.replace(/_/g, " ") ?? "Recorded"}
            </p>
          </li>
        ) : (
          <li key={`decision-${item.entry.id}`} className="py-3 text-sm">
            <p>{day(item.at)} · {DECISIONS[item.entry.action] ?? "Reviewed"}</p>
            {item.entry.message && <p className="mt-1 text-xs text-fg-secondary">{effectWords(item.entry.message, "done")}</p>}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-fg-secondary">No history recorded.</p>
    )}
    {total > items.length && (
      <p className="mt-3 text-xs text-fg-secondary">
        Showing the latest {items.length} of {total} events.
      </p>
    )}
  </>;
}
