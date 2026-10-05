"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import { EditionImageBox } from "@/components/books/edition-cover";
import { PublisherSearch } from "./publisher-picker";
import {
  applySafePublisherDecisions,
  resolvePublisherNames,
  restorePublisherName,
  undoAutomaticPublisherDecision,
  type getPublisherNameInbox,
  type PublisherNameRow,
} from "@/lib/actions/publisher-names";
import { SectionHeading } from "@/components/shared/section-heading";

type Decision = Parameters<typeof resolvePublisherNames>[0][number];
type Inbox = Awaited<ReturnType<typeof getPublisherNameInbox>>;

const COVERS = 8;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What a save did, short enough for one toast line */
function summary(r: Awaited<ReturnType<typeof resolvePublisherNames>>) {
  if (!r.linked && r.ignored) return "Marked as not a publisher";
  return [
    `Linked ${plural(r.linked, "edition")}`,
    r.created.length ? ` to ${plural(r.created.length, "new house")}` : "",
    r.prefixes.length ? ` · ${plural(r.prefixes.length, "ISBN rule")}` : "",
  ].join("");
}

/** A checkbox on the cap-height center of the first line of its label */
function CheckLabel({
  checked,
  onChange,
  disabled,
  className = "",
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex gap-2 ${className}`}>
      <CapAligned height={13}>
        <input
          type="checkbox"
          className="m-0 block h-[13px] w-[13px]"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      </CapAligned>
      <span>{children}</span>
    </label>
  );
}

/** What the automatic path does with the name, or why it waits for you */
function AutomaticLine({ row }: { row: PublisherNameRow }) {
  const a = row.automatic;
  if (a.action === "hold")
    return (
      <p className="text-sm text-fg-secondary">
        <span className="text-accent-gold">Needs you:</span> {a.reason}
      </p>
    );
  return (
    <p className="text-sm text-fg-secondary">
      <span className="text-accent-sage">Safe to decide:</span>{" "}
      {a.action === "alias" ? `link to ${a.publisher.name}` : `new house “${a.name}”`}
      <span className="text-fg-secondary"> · {a.reason}</span>
    </p>
  );
}

function NameRow({
  row,
  usePrefixes,
  onUsePrefixes,
  pending,
  decide,
}: {
  row: PublisherNameRow;
  usePrefixes: boolean;
  onUsePrefixes: (use: boolean) => void;
  pending: boolean;
  decide: (items: Decision[]) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const ambiguous = row.candidates > 1;
  const reach = row.prefixes.reduce((n, p) => n + p.reach, 0);
  const titles = row.editions.map((e) => e.workTitle);
  const link = (publisherId: string) =>
    decide([{ key: row.key, action: "link", publisherId, usePrefixes }]);
  return (
    <article className="space-y-3 rounded-sm border border-glass-border p-4">
      <div className="space-y-1">
        <h3 className="type-item-title">{row.name}</h3>
        <p className="text-xs text-fg-secondary">
          {plural(row.editions.length, "edition")}
          {row.prefixes.length > 0 &&
            ` · ISBN ${row.prefixes.map((p) => p.label).join(", ")}`}
          {ambiguous && ` · Matches ${row.candidates} houses with this name`}
        </p>
      </div>
      <div className="flex gap-1.5">
        {row.editions.slice(0, COVERS).map((e) => (
          <Link
            key={e.id}
            href={`/library/${e.workSlug}#edition-${e.id}`}
            aria-label={e.workTitle}
            data-tooltip={e.workTitle}
          >
            <EditionImageBox image={e.image} title={e.workTitle} size="sm" />
          </Link>
        ))}
        {row.editions.length > COVERS && (
          <span className="flex h-12 items-center px-1 text-xs text-fg-secondary">
            +{row.editions.length - COVERS}
          </span>
        )}
      </div>
      <p className="lines-1 text-xs text-fg-secondary">
        {titles.slice(0, 3).join(", ")}
        {titles.length > 3 && ` and ${titles.length - 3} more`}
      </p>
      <AutomaticLine row={row} />
      {row.suggestions.map((s) => (
        <p key={s.publisher.id} className="text-sm text-fg-secondary">
          Suggested:{" "}
          <Link
            href={`/publishers/${s.publisher.slug}`}
            className="text-accent-blue hover:underline"
          >
            {s.publisher.name}
          </Link>
          <span className="text-fg-secondary"> · {s.reason}</span>
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        {row.suggestions.map((s, i) => (
          <Button
            key={s.publisher.id}
            size="sm"
            variant={i === 0 ? "primary" : "secondary"}
            disabled={pending}
            onClick={() => link(s.publisher.id)}
            className="max-w-full"
          >
            {/* A long house name ends in an ellipsis on a phone: the line above names it whole */}
            <span className="min-w-0 truncate">
              {s.via === "isbn"
                ? `Link ${row.editions.length === 1 ? "it" : `these ${row.editions.length}`} to `
                : "Link to "}
              {s.publisher.name}
            </span>
          </Button>
        ))}
        <Button
          size="sm"
          variant={row.suggestions.length ? "ghost" : "secondary"}
          disabled={pending}
          onClick={() => setChoosing(!choosing)}
          aria-expanded={choosing}
        >
          {row.suggestions.length ? "Choose another house" : "Choose a house"}
        </Button>
        {!ambiguous && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => decide([{ key: row.key, action: "create", usePrefixes }])}
            className="max-w-full"
          >
            <span className="min-w-0 truncate">Create &ldquo;{row.cleanName}&rdquo;</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => decide([{ key: row.key, action: "ignore" }])}
          data-tooltip="A distributor or printer: this name never links to a house"
        >
          Not a publisher
        </Button>
      </div>
      {choosing && (
        <div className="max-w-md">
          <PublisherSearch
            label={ambiguous ? "House for these editions" : "House for this name"}
            allowCreate
            autoFocus
            disabled={pending}
            onSelect={(p) => link(p.id)}
          />
        </div>
      )}
      {row.prefixes.length > 0 && (
        <CheckLabel
          className="text-xs leading-5 text-fg-secondary"
          checked={usePrefixes}
          disabled={pending}
          onChange={onUsePrefixes}
        >
          Also save ISBN {row.prefixes.map((p) => p.label).join(", ")} for the
          house
          {reach > 0
            ? `. This also links ${plural(reach, "more edition")} without a house.`
            : ", so later books with it link by themselves."}
        </CheckLabel>
      )}
    </article>
  );
}

/**
 * Publisher names inbox: one row per name that editions without a house
 * carry. A decision applies to every edition with the name. Safe decisions
 * apply in one step; every automatic decision can be undone.
 */
export function PublisherNameInbox({
  rows,
  ignored,
  safe,
  decisions,
}: Pick<Inbox, "rows" | "ignored" | "safe" | "decisions">) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // ISBN rules are on by default only when they reach no other edition now
  const [prefixChoice, setPrefixChoice] = useState<Record<string, boolean>>({});
  const usesPrefixes = (r: PublisherNameRow) =>
    prefixChoice[r.key] ?? r.prefixes.every((p) => p.reach === 0);

  function run(task: () => Promise<string | void>) {
    start(async () => {
      try {
        const message = await task();
        if (message) toast.success(message);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save");
      }
    });
  }
  const decide = (items: Decision[]) =>
    run(async () => summary(await resolvePublisherNames(items)));

  return (
    <div className="space-y-5">
      {safe.aliases + safe.creates > 0 && (
        <section className="space-y-2 rounded-sm border border-glass-border p-4">
          <p className="text-sm text-fg-secondary">
            {plural(safe.aliases + safe.creates, "name")} can be decided safely:{" "}
            {plural(safe.aliases, "link")} to a similar house,{" "}
            {plural(safe.creates, "new house")}. They cover{" "}
            {plural(safe.editions, "edition")}. Every one can be undone below.
          </p>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await applySafePublisherDecisions();
                return `Linked ${plural(r.linked, "edition")} · ${plural(r.created.length, "new house")}`;
              })
            }
          >
            Apply {plural(safe.aliases + safe.creates, "safe decision")}
          </Button>
        </section>
      )}
      {rows.map((row) => (
        <NameRow
          key={row.key}
          row={row}
          pending={pending}
          decide={decide}
          usePrefixes={usesPrefixes(row)}
          onUsePrefixes={(use) => setPrefixChoice({ ...prefixChoice, [row.key]: use })}
        />
      ))}
      {!rows.length && (
        <p className="py-6 text-fg-secondary">Every edition with a publisher name has a house.</p>
      )}
      {decisions.length > 0 && (
        <section className="space-y-2 border-t border-glass-border pt-5">
          <SectionHeading
            title="Automatic decisions"
            description="Made when books were added or from the safe list. Undo returns the name here for you to decide; it is never decided automatically again."
          />
          <ul className="space-y-1">
            {decisions.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-fg-secondary"
              >
                <span className="font-mono text-xs text-fg-secondary">
                  {d.createdAt.slice(0, 10)}
                </span>
                <span>
                  &ldquo;{d.name}&rdquo; {d.action === "create" ? "became" : "linked to"}{" "}
                  {d.house ? (
                    <Link href={`/publishers/${d.house.slug}`} className="text-accent-blue">
                      {d.house.name}
                    </Link>
                  ) : (
                    "a removed house"
                  )}
                </span>
                <span className="text-xs text-fg-secondary">
                  {plural(d.editionCount, "edition")} · {d.reason}
                </span>
                {d.undone ? (
                  <span className="text-xs text-fg-secondary">Undone</span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        await undoAutomaticPublisherDecision(d.id);
                        return "Undone";
                      })
                    }
                  >
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {ignored.length > 0 && (
        <section className="space-y-2 border-t border-glass-border pt-5">
          <SectionHeading
            title="Not publishers"
            description="These names never link to a house. Their editions link by ISBN only."
          />
          <ul className="space-y-1">
            {ignored.map((n) => (
              <li key={n.key} className="flex flex-wrap items-baseline gap-3 text-sm text-fg-secondary">
                <span>{n.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      await restorePublisherName(n.key);
                    })
                  }
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
