"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TitleInput } from "@/components/shared/title-input";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { createPerfume, updatePerfume } from "@/lib/actions/perfumes";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import {
  CreditListField,
  NotePyramidEditor,
  OrganizationRolesField,
  TermListField,
  type CreditEntry,
  type NoteEntry,
  type OrganizationEntry,
  type TermEntry,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = !title.trim() || Object.values(dateErrors).some(Boolean);

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
      const message = err instanceof Error ? err.message : "Could not save the perfume";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    // ⌘Enter saves; on the create page this is the page's shortcut scope
    <div className="space-y-8" data-shortcut-scope="">
      <Section title="Identity">
        <TitleInput
          label="Title"
          value={title}
          onValueChange={setTitle}
          placeholder="Shalimar"
          maxLength={500}
          required
        />
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

      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() =>
            props.mode === "edit" ? props.onCancel() : router.push("/perfumes")
          }
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          data-shortcut="save"
          onClick={save}
          disabled={blocked || saving}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {props.mode === "create" ? "Add perfume" : "Save"}
        </Button>
      </div>
    </div>
  );
}
