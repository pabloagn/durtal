import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import {
  SettingRow,
  SettingsGroup,
  SettingsIntro,
} from "@/components/settings/settings-group";
import { catalogueCounts, reviewQueueCounts } from "@/lib/settings/data";
import { ExportRow, RefreshCacheRow } from "./data-actions";

export const metadata = { title: "Data settings" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A review queue: what it holds, how much waits, and a link to it. */
function QueueRow({
  id,
  label,
  description,
  waiting,
  href,
}: {
  id: string;
  label: string;
  description: string;
  waiting?: string;
  href: string;
}) {
  return (
    <SettingRow id={id} label={label} description={description} controlHeight={28} labelFor={false}>
      {waiting && <span className="text-sm text-fg-secondary">{waiting}</span>}
      <Link href={href} aria-describedby={`${id}-description`} className={buttonClass("secondary", "sm")}>
        Open
        <span className="sr-only"> {label}</span>
      </Link>
    </SettingRow>
  );
}

export default async function DataSettingsPage() {
  const [counts, queues] = await Promise.all([catalogueCounts(), reviewQueueCounts()]);
  return (
    <>
      <SettingsIntro>
        The catalogue in numbers, the queues of records to review, exports and the cache.
      </SettingsIntro>

      <SettingsGroup title="Catalogue">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-5">
          {counts.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-fg-secondary">{label}</dt>
              <dd className="mt-1 font-serif text-lg tabular-nums text-fg-primary">
                {value.toLocaleString("en-GB")}
              </dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>

      <SettingsGroup title="Review queues">
        <QueueRow
          id="queue-identify"
          label="Identify editions"
          description="Editions that hold a placeholder from the old import instead of a real book."
          waiting={plural(queues.identify, "edition", "editions")}
          href="/library/identify"
        />
        <QueueRow
          id="queue-series"
          label="Series suggestions"
          description="Books whose title names a series they are not in yet."
          waiting={`${plural(queues.suggestedBooks, "book", "books")} in ${plural(queues.suggestedSeries, "series", "series")}`}
          href="/series/suggestions"
        />
        <QueueRow
          id="queue-publishers"
          label="Publisher names"
          description="Names from book sources that are not linked to a publisher yet, and the automatic links, which you can undo."
          href="/publishers/review"
        />
        <QueueRow
          id="queue-harmonize"
          label="Harmonize"
          description="Duplicates and records that do not agree. It scans the whole catalogue when it opens."
          href="/harmonize"
        />
      </SettingsGroup>

      <SettingsGroup title="Export" description="The whole catalogue as one file. A list's own export takes the records you select.">
        <ExportRow
          entity="works"
          label="Books"
          description="Every book: title, authors, status, rating, its first edition, publishers and the number of copies."
        />
        <ExportRow
          entity="authors"
          label="Authors"
          description="Every author of a book: names, dates, nationality, biography and the number of books."
        />
      </SettingsGroup>

      <SettingsGroup title="Cache">
        <RefreshCacheRow />
      </SettingsGroup>
    </>
  );
}
