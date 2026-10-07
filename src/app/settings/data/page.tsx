import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import {
  SettingFact,
  SettingRow,
  SettingsGroup,
  SettingsIntro,
} from "@/components/settings/settings-group";
import { catalogueCounts, enrichmentSpend, evidenceCacheStats, reviewQueueCounts } from "@/lib/settings/data";
import { ExportRow, RefreshCacheRow } from "./data-actions";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";

export const metadata = { title: "Data settings" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
/** Bytes as KB, MB or GB, one decimal */
function size(bytes: number) {
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${value} bytes` : `${value.toFixed(1)} ${units[unit]}`;
}

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
  const [counts, queues, spend, evidence] = await Promise.all([
    catalogueCounts(),
    reviewQueueCounts(),
    enrichmentSpend(),
    evidenceCacheStats(),
  ]);
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

      <SettingsGroup title="Import">
        <QueueRow
          id="import-reading"
          label="Import reading history"
          description="Readings from a Goodreads or StoryGraph export, or a Durtal reading CSV, with a preview of every row before anything is written."
          href="/reading/import"
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
          label="People"
          description="Every person: names, dates, nationality, biography and the number of books."
        />
        <ExportRow
          entity="readings"
          label="Readings"
          description="Every reading as a Durtal reading CSV, which imports back with nothing duplicated, then its edition, copy, sessions, minutes and pages read."
        />
        <ExportRow
          entity="reading-sessions"
          label="Reading sessions"
          description="Every session: day, times, time zone, duration, start and end, pages counted, edition and format. A running timer is left out."
        />
        <ExportRow
          entity="reading-notes"
          label="Quotes and notes"
          description="Every quote and note with its book, page, chapter and thought. Markdown gives your commonplace book, one heading per book."
        />
        <ExportRow
          entity="goodreads"
          label="Goodreads file"
          description="Your shelves and reads in Goodreads' own export format, which Goodreads and StoryGraph import. Half stars round up, and only exact dates go out."
        />
        {WORK_DOMAINS.perfume.enabled && (
          <ExportRow
            entity="perfumes"
            label="Perfumes"
            description="Every perfume: houses, perfumers, release, concentrations, families, accords, notes, the bottles and samples you keep, rating and notes."
          />
        )}
        {WORK_DOMAINS.film.enabled && (
          <ExportRow
            entity="films"
            label="Films"
            description="Every film: directors, writers, cast, release, runtime, countries, languages, genres, the copies you keep, rating and notes."
          />
        )}
        {WORK_DOMAINS.painting.enabled && (
          <ExportRow
            entity="paintings"
            label="Paintings"
            description="Every painting: painters, date, movements, genres, techniques, media, supports, the original's owner and size, what you own, rating and notes."
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="Enrichment">
        <SettingFact label="Spend this month" description="Paid search and model calls of the book enrichment, against the monthly cap.">
          <span data-enrichment-spend="">
            {spend.cap === null
              ? `${usd(spend.spent + spend.reserved)}, no cap set`
              : `${usd(spend.spent + spend.reserved)} of ${usd(spend.cap)}`}
          </span>
        </SettingFact>
        <SettingFact label="Evidence cache" description="Private copies of review and publisher pages, kept to check quotes. Never shown or exported.">
          <span data-evidence-cache="">
            {plural(evidence.documents, "document", "documents")}, {size(evidence.bytes)}
          </span>
        </SettingFact>
      </SettingsGroup>

      <SettingsGroup title="Cache">
        <RefreshCacheRow />
      </SettingsGroup>
    </>
  );
}
