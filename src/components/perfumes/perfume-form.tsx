"use client";

import { useSaveReason } from "@/components/shared/save-reason";

import { NameDuplicateNotice } from "@/components/shared/name-duplicate-notice";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { toast } from "@/lib/notifications/toast";
import { DialogFooter, PINNED_PAGE_FOOTER } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TitleInput } from "@/components/shared/title-input";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { createPerfumeVariant, createPerfume, updatePerfume } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";
import { recordPerfumeEntrySource, type PerfumeSourceReview } from "@/lib/actions/perfume-sources";
import { SourceLinkField, type SourceLinkState } from "./source-link-field";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { TermListField, type TermEntry } from "@/components/catalogue/record-fields";
import {
  CreditListField,
  NotePyramidEditor,
  OrganizationRolesField,
  creditEntryKey,
  type CreditEntry,
  type NoteEntry,
  type OrganizationEntry,
} from "./perfume-fields";

/** The identity of a stored perfume, as the edit form starts from it */
export interface EditablePerfume {
  id: string;
  title: string;
  description: string | null;
  releaseDate: CatalogueDateInput | null;
  discontinuedDate: CatalogueDateInput | null;
  organizations: OrganizationEntry[];
  credits: CreditEntry[];
  sourceRecordId: string | null;
}

type Props =
  | { mode: "create" }
  | {
      mode: "edit";
      perfume: EditablePerfume;
      fingerprint: string;
      /** The perfume's sources, to cite one for its dates */
      sources: { id: string; label: string }[];
      onSaved: () => void;
      onCancel: () => void;
    };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="type-group-title">{title}</h3>
      {children}
    </section>
  );
}

/**
 * A perfume's identity: title, house and people, launch and discontinuation,
 * description. A new perfume also takes its notes, families and accords;
 * a stored one edits those on its page. Unknown values stay unknown: no
 * field is required but the title.
 */
export function PerfumeForm(props: Props) {
  const router = useRouter();
  const editing = props.mode === "edit" ? props.perfume : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [organizations, setOrganizations] = useState<OrganizationEntry[]>(
    editing?.organizations ?? [],
  );
  const [credits, setCredits] = useState<CreditEntry[]>(editing?.credits ?? []);
  const [release, setRelease] = useState(editing?.releaseDate ?? null);
  const [discontinued, setDiscontinued] = useState(editing?.discontinuedDate ?? null);
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [families, setFamilies] = useState<TermEntry[]>([]);
  const [accords, setAccords] = useState<TermEntry[]>([]);
  const [sourceRecordId, setSourceRecordId] = useState(editing?.sourceRecordId ?? null);
  const [sourceLink, setSourceLink] = useState<SourceLinkState>({ link: "", reading: null, addFormulation: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkInvalid = sourceLink.link.trim() !== "" && !sourceLink.reading;
  const blocked = !title.trim() || Object.values(dateErrors).some(Boolean) || linkInvalid;

  /** Fills what the form lacks from a source; what the person typed stays */
  function takeSource({ title: name, review }: { title: string | null; review: PerfumeSourceReview | null }) {
    if (name && (!review || !title.trim())) setTitle(name);
    if (!review) return;
    if (!description.trim() && review.values.description) setDescription(review.values.description);
    if (!release && review.values.launched) setRelease(review.values.launched);
    const houses = review.organizations.filter(
      (o) => o.match && !organizations.some((x) => x.organizationId === o.match!.id && x.role === o.role),
    );
    if (houses.length)
      setOrganizations([
        ...organizations,
        ...houses.map((o) => ({ organizationId: o.match!.id, name: o.match!.name, role: o.role, sourceRecordId: null })),
      ]);
    const people = review.perfumers.filter((p) => p.match && !credits.some((c) => c.personId === p.match!.id));
    if (people.length)
      setCredits([
        ...credits,
        ...people.map((p) => ({ key: creditEntryKey(), personId: p.match!.id, name: p.match!.name, creditedAs: null, attribution: "attributed" as const })),
      ]);
  }

  /** After a new perfume is saved: its source, and the formulation its link names */
  async function keepSource(perfumeId: string) {
    const { reading, link, addFormulation } = sourceLink;
    if (!reading) return;
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const kept = await recordPerfumeEntrySource({ perfumeId, link, retrievedOn: day });
    if ("error" in kept) toast.error(`The perfume is saved, but not its source: ${kept.error}`);
    if (addFormulation && reading.hints.concentration) {
      try {
        await createPerfumeVariant({
          workId: perfumeId,
          concentration: reading.hints.concentration,
          sourceRecordId: "error" in kept ? null : kept.sourceRecordId,
        });
      } catch (err) {
        toast.error(`The perfume is saved, but not its formulation: ${refusalMessage(err, "it was refused")}`);
      }
    }
  }

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const identity = {
      title: title.trim(),
      description: description.trim() || null,
      releaseDate: release,
      discontinuedDate: discontinued,
      organizations: organizations.map(({ organizationId, role, sourceRecordId }) => ({
        organizationId,
        role,
        sourceRecordId,
      })),
      credits: credits.map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        personId: c.personId,
        roleId: c.roleId ?? "perfume.perfumer",
        creditedAs: c.creditedAs,
        attribution: c.attribution,
        notes: c.notes ?? null,
      })),
    };
    try {
      if (props.mode === "create") {
        const perfume = await createPerfume({
          ...identity,
          organizations: identity.organizations.map(({ organizationId, role }) => ({
            organizationId,
            role,
          })),
          notePyramid: notes.map(({ itemId, position }) => ({ itemId, position })),
          classificationItemIds: [...families, ...accords].map((t) => t.id),
        });
        await keepSource(perfume.id);
        toast.success("Perfume added");
        router.push(`/perfumes/${perfume.slug ?? perfume.id}`);
      } else {
        await updatePerfume(
          props.perfume.id,
          { ...identity, sourceRecordId },
          props.fingerprint,
        );
        toast.success("Perfume saved");
        props.onSaved();
      }
    } catch (err) {
      const message = refusalMessage(err, "Could not save the perfume");
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  // On the create page, Esc cancels like Cancel, asking first when there is
  // unsaved work. In the edit dialog, the dialog does the same.
  const root = useRef<HTMLDivElement>(null);
  const unsavedPrompt = useEscapeToCancel({
    root,
    cancel: () => router.push("/perfumes"),
    enabled: props.mode === "create" && !saving,
    track: true,
  });

  const nameReason = useSaveReason(!title.trim() && "Give the perfume a title");
  return (
    // ⌘Enter saves; on the create page this is the page's shortcut scope
    <>
    {unsavedPrompt}
    <div ref={root} className="space-y-8" data-shortcut-scope="">
      {props.mode === "create" && (
        <Section title="Source">
          <SourceLinkField value={sourceLink} onChange={setSourceLink} onUse={takeSource} />
        </Section>
      )}
      <Section title="Identity">
        <div className="min-w-0 space-y-2"><TitleInput
          label="Title"
          value={title}
          onValueChange={setTitle}
          placeholder="Shalimar"
          maxLength={500}
          required
        /><NameDuplicateNotice kind="perfume" name={title} enabled={props.mode === "create"} /></div>
        <div className="space-y-2 pt-1">
          <OrganizationRolesField value={organizations} onChange={setOrganizations} />
          <CreditListField label="People" value={credits} onChange={setCredits} roles />
        </div>
      </Section>

      <Section title="Dates">
        <div className="grid gap-4 md:grid-cols-2">
          <CatalogueDateField
            label="Launched"
            value={release}
            onChange={(value, err) => {
              setRelease(value);
              setDateErrors((e) => ({ ...e, release: err }));
            }}
          />
          <CatalogueDateField
            label="Discontinued"
            value={discontinued}
            onChange={(value, err) => {
              setDiscontinued(value);
              setDateErrors((e) => ({ ...e, discontinued: err }));
            }}
          />
        </div>
        {props.mode === "edit" && props.sources.length > 0 && (
          <div className="max-w-sm">
            <Select
              label="Source of these dates"
              value={sourceRecordId ?? ""}
              placeholder="No source"
              onChange={(e) => setSourceRecordId(e.target.value || null)}
              options={props.sources.map((s) => ({ value: s.id, label: s.label }))}
            />
          </div>
        )}
      </Section>

      <Section title="Description">
        <Textarea
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={50000}
          placeholder="How it smells, how it came to be"
        />
      </Section>

      {props.mode === "create" && (
        <>
          <Section title="Notes">
            <NotePyramidEditor value={notes} onChange={setNotes} />
          </Section>
          <Section title="Classification">
            <div className="space-y-2">
              <TermListField
                label="Families"
                family={{ slug: "perfume-families", name: "Perfume families" }}
                value={families}
                onChange={setFamilies}
              />
              <TermListField
                label="Accords"
                family={{ slug: "perfume-accords", name: "Perfume accords" }}
                value={accords}
                onChange={setAccords}
              />
            </div>
          </Section>
        </>
      )}

      {/* Always in view, with the reason a save failed over the buttons:
          under the edit dialog's body, or pinned to the bottom of the add
          page (SLN-943) */}
      <DialogFooter outside={PINNED_PAGE_FOOTER}>
        {nameReason.hint}
        {error && (
          <p role="alert" className="basis-full text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <Button
          variant="ghost"
          data-dismiss=""
          onClick={() =>
            props.mode === "edit" ? props.onCancel() : router.push("/perfumes")
          }
          disabled={saving}
        >
          Cancel
        </Button>
        <Button aria-describedby={nameReason.describedBy}
          variant="primary"
          data-shortcut="save"
          onClick={save}
          busy={saving}
          disabled={blocked}
        >
          {props.mode === "create" ? "Add perfume" : "Save"}
        </Button>
      </DialogFooter>
    </div>
    </>
  );
}
