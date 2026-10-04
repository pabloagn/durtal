"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAligned } from "@/components/shared/cap-aligned";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { SingleChoiceField } from "./record-fields";
import type { PickerChoice } from "./search-picker";
import {
  createWorkRelation,
  deleteWorkRelation,
  getWorkSourceChoices,
  searchWorksForRelation,
  type WorkRelationView,
} from "@/lib/actions/work-relations";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import {
  WORK_RELATION_LABELS,
  WORK_RELATION_TYPES,
  relationNeedsSource,
  relationTargetKinds,
  type WorkRelationType,
} from "@/lib/catalogue/work-relations";

export interface RelatedWorkOwner {
  id: string;
  kind: WorkKind;
  title: string;
}

/** How a choice of link reads in the dialog: "Adapted from a book" */
const PHRASES: Record<WorkRelationType, { outgoing: string; incoming: string }> = {
  adaptation: { outgoing: "Adapted from", incoming: "Adapted as" },
  remake: { outgoing: "A remake of", incoming: "Remade as" },
  flanker: { outgoing: "A flanker of", incoming: "Has the flanker" },
  inspiration: { outgoing: "Inspired by", incoming: "Inspired" },
};
const ARTICLES: Record<WorkKind, string> = {
  book: "a book",
  film: "a film",
  perfume: "a perfume",
  painting: "a painting",
};

/** Today in the browser's calendar, as YYYY-MM-DD */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The links this work can take, each with the kinds at the other end */
function linkChoices(kind: WorkKind, enabled: WorkKind[]) {
  return WORK_RELATION_TYPES.flatMap((type) =>
    (["outgoing", "incoming"] as const).flatMap((direction) => {
      const kinds = relationTargetKinds(type, kind, direction, enabled);
      if (!kinds.length) return [];
      const what =
        type === "inspiration" ? "another work" : kinds.map((k) => ARTICLES[k]).join(" or ");
      return [{ value: `${type}:${direction}`, type, direction, kinds, label: `${PHRASES[type][direction]} ${what}` }];
    }),
  );
}

/**
 * Records a link between this work and another: an adaptation, a remake, a
 * flanker or an inspiration, in either direction. The link cites a source of
 * the work it starts from, chosen from that work's sources or added here; an
 * inspiration must cite one.
 */
export function WorkRelationDialog({
  open,
  onClose,
  work,
}: {
  open: boolean;
  onClose: () => void;
  work: RelatedWorkOwner;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Link a work" description={work.title} className="max-w-2xl">
      {open && <RelationForm work={work} onDone={onClose} />}
    </Dialog>
  );
}

function RelationForm({ work, onDone }: { work: RelatedWorkOwner; onDone: () => void }) {
  const router = useRouter();
  const choices = useMemo(() => linkChoices(work.kind, getEnabledWorkKinds()), [work.kind]);
  const [choice, setChoice] = useState(choices[0]?.value ?? "");
  const current = choices.find((c) => c.value === choice) ?? choices[0];
  const [other, setOther] = useState<{ id: string; label: string } | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The link cites a source of the work it starts from
  const fromId = current?.direction === "outgoing" ? work.id : other?.id;
  const fromTitle = current?.direction === "outgoing" ? work.title : other?.label;
  useEffect(() => {
    let live = true;
    setSourceId("");
    if (!fromId) return setSources([]);
    getWorkSourceChoices(fromId)
      .then((found) => live && setSources(found))
      .catch(() => live && setSources([]));
    return () => {
      live = false;
    };
  }, [fromId]);

  const kinds = current?.kinds ?? [];
  const search = useCallback(
    async (query: string): Promise<PickerChoice[]> =>
      (await searchWorksForRelation({ query, kinds, excludeId: work.id })).map((w) => ({
        id: w.id,
        label: w.title,
        hint: [WORK_DOMAINS[w.kind].label, w.creators].filter(Boolean).join(", "),
      })),
    // The kinds change with the choice of link
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kinds.join(","), work.id],
  );

  const needsSource = current ? relationNeedsSource(current.type) : false;
  const validUrl = !sourceUrl.trim() || /^https?:\/\/[^\s@/]+/.test(sourceUrl.trim());
  const blocked =
    !current ||
    !other ||
    !validUrl ||
    (!!sourceUrl.trim() && !sourceName.trim()) ||
    (needsSource && !sourceId && !sourceName.trim()) ||
    saving;

  async function save() {
    if (blocked || !current || !other) return;
    setSaving(true);
    setError(null);
    try {
      await createWorkRelation({
        type: current.type,
        fromWorkId: current.direction === "outgoing" ? work.id : other.id,
        toWorkId: current.direction === "outgoing" ? other.id : work.id,
        sourceRecordId: sourceId || null,
        newSource:
          !sourceId && sourceName.trim()
            ? { attribution: sourceName.trim(), url: sourceUrl.trim() || null, retrievedOn: today() }
            : null,
        notes: notes.trim() || null,
      });
      toast.success("Works linked");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not link the works";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  if (!choices.length)
    return <p className="text-sm text-fg-secondary">This work has no links to record yet.</p>;

  return (
    <div className="space-y-6">
      <Select
        label={`${work.title} is`}
        value={choice}
        onChange={(e) => {
          setChoice(e.target.value);
          setOther(null);
        }}
        options={choices.map((c) => ({ value: c.value, label: c.label }))}
      />
      <SingleChoiceField
        label="Work"
        value={other}
        onChange={setOther}
        search={search}
        placeholder="Search titles..."
      />
      <fieldset className="space-y-3">
        <legend className="type-group-title mb-3">
          Source{needsSource ? "" : " (optional)"}
        </legend>
        <p className="text-xs text-fg-secondary">
          {fromTitle
            ? `Where it is stated. The source belongs to ${fromTitle}.`
            : "Choose the work first: the source belongs to the work the link starts from."}
          {needsSource && " An inspiration always cites one."}
        </p>
        {sources.length > 0 && (
          <Select
            label="A recorded source"
            value={sourceId}
            placeholder="None: add one below"
            onChange={(e) => setSourceId(e.target.value)}
            options={sources.map((s) => ({ value: s.id, label: s.label }))}
          />
        )}
        {!sourceId && (
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label="New source"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="The film's opening credits, an interview"
              maxLength={1000}
              disabled={!fromId}
            />
            <Input
              label="Address"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https:// (none for a book or a box)"
              maxLength={4000}
              disabled={!fromId}
              error={validUrl ? undefined : "Enter an address that starts with http:// or https://"}
            />
          </div>
        )}
      </fieldset>
      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Loosely, the second half only"
      />
      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} disabled={blocked}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          Link
        </Button>
      </div>
    </div>
  );
}

/**
 * The links someone recorded between this work and others: adaptations,
 * remakes, flankers, sourced inspirations. They are facts with sources, kept
 * apart from the related rows, which only suggest. With `showEmpty` off (the
 * book page), the section is left out when there is nothing to show and the
 * page's actions menu holds "Link a work".
 */
export function LinkedWorksSection({
  work,
  relations,
  showEmpty = true,
}: {
  work: RelatedWorkOwner;
  relations: WorkRelationView[];
  showEmpty?: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WorkRelationView | null>(null);
  const groups = WORK_RELATION_TYPES.flatMap((type) =>
    (["outgoing", "incoming"] as const).flatMap((direction) => {
      const items = relations.filter((r) => r.type === type && r.direction === direction);
      return items.length ? [{ key: `${type}:${direction}`, label: WORK_RELATION_LABELS[type][direction], items }] : [];
    }),
  );
  if (!relations.length && !showEmpty) return null;

  return (
    <section className="mb-10" aria-labelledby="linked-works">
      <SectionHeading
        id="linked-works"
        title="Linked works"
        count={relations.length || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Link a work
          </Button>
        }
      />
      {groups.length === 0 ? (
        <p className="max-w-xl text-sm text-fg-secondary">
          No links recorded. Record an adaptation, a remake, a flanker or a
          sourced inspiration; a shared title or genre is not a link.
        </p>
      ) : (
        <dl className="space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              <dt className="type-label mb-1.5">{group.label}</dt>
              <dd>
                <ul className="space-y-1.5">
                  {group.items.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="text-fg-primary">
                          <Link href={r.other.href} className="transition-colors hover:text-accent-rose-text">
                            {r.other.title}
                          </Link>
                          <span className="text-fg-secondary">
                            {" · "}
                            {[WORK_DOMAINS[r.other.kind].label, r.other.creators].filter(Boolean).join(", ")}
                          </span>
                        </p>
                        {(r.source || r.notes) && (
                          <p className="flex flex-wrap items-start gap-x-1.5 text-xs text-fg-secondary">
                            {r.source &&
                              (r.source.url ? (
                                <>
                                  <a
                                    href={r.source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="transition-colors hover:text-accent-rose-text"
                                  >
                                    Source: {r.source.label}
                                  </a>
                                  <CapAligned height={12}>
                                    <ExternalLink className="h-3 w-3 text-fg-muted" strokeWidth={1.5} aria-hidden />
                                  </CapAligned>
                                </>
                              ) : (
                                <span>Source: {r.source.label}</span>
                              ))}
                            {r.notes && <span>{r.source ? `· ${r.notes}` : r.notes}</span>}
                          </p>
                        )}
                      </div>
                      <CapAligned height={20}>
                        <button
                          type="button"
                          aria-label={`Remove the link to ${r.other.title}`}
                          data-tooltip="Remove link"
                          onClick={() => setRemoving(r)}
                          className="flex h-5 w-5 items-center justify-center rounded-sm text-fg-muted transition-colors hover:text-accent-red-text"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </CapAligned>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <WorkRelationDialog open={adding} onClose={() => setAdding(false)} work={work} />
      <ConfirmDeleteDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove link"
        name={removing ? `${work.title} · ${removing.other.title}` : ""}
        description="The link is removed; both works and its source stay."
        onConfirm={async () => {
          if (!removing) return;
          try {
            await deleteWorkRelation(removing.id);
            toast.success("Link removed");
            setRemoving(null);
            router.refresh();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not remove the link");
          }
        }}
      />
    </section>
  );
}
