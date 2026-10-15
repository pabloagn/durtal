"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { toast } from "@/lib/notifications/toast";
import { DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TitleInput } from "@/components/shared/title-input";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { TermListField, type TermEntry } from "@/components/catalogue/record-fields";
import { ChoiceListField, type Choice } from "@/components/films/film-fields";
import { createPainting, updatePainting, type PaintingChoices } from "@/lib/actions/paintings";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import {
  PAINTING_FAMILIES,
  painterInput,
  type PainterEntry,
  type PaintingFamilyKey,
} from "@/lib/catalogue/painting-labels";
import { PaintersField } from "./painting-fields";
import { paintingHref } from "./painting-card";

/** The identity of a stored painting, as the edit form starts from it */
export interface EditablePainting {
  id: string;
  title: string;
  description: string | null;
  creationDate: CatalogueDateInput | null;
  sourceRecordId: string | null;
  painters: PainterEntry[];
  movements: Choice[];
  classification: Record<PaintingFamilyKey, TermEntry[]>;
  /** Items of other families the painting carries; kept on save */
  otherItemIds: string[];
}

type Props =
  | { mode: "create"; choices: PaintingChoices }
  | {
      mode: "edit";
      choices: PaintingChoices;
      painting: EditablePainting;
      fingerprint: string;
      /** The painting's sources, to cite one for its date */
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

const EMPTY_CLASSIFICATION: Record<PaintingFamilyKey, TermEntry[]> = {
  genres: [],
  techniques: [],
  media: [],
  supports: [],
};

/**
 * A painting's identity: title, painters, date, movements, the families that
 * describe it and a description. The original, its versions and any
 * reproduction are objects, added on its page. No field is required but the
 * title: unknown values stay unknown.
 */
export function PaintingForm(props: Props) {
  const router = useRouter();
  const editing = props.mode === "edit" ? props.painting : null;
  const [title, setTitle] = useState(editing?.title ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [created, setCreated] = useState(editing?.creationDate ?? null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [painters, setPainters] = useState<PainterEntry[]>(editing?.painters ?? []);
  const [movements, setMovements] = useState<Choice[]>(editing?.movements ?? []);
  const [classification, setClassification] = useState(
    editing?.classification ?? EMPTY_CLASSIFICATION,
  );
  const [sourceRecordId, setSourceRecordId] = useState(editing?.sourceRecordId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = !title.trim() || !!dateError;

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const identity = {
      title: title.trim(),
      description: description.trim() || null,
      creationDate: created,
      credits: painterInput(painters),
      artMovementIds: movements.map((m) => m.id),
      classificationItemIds: [
        ...Object.values(classification).flatMap((terms) => terms.map((t) => t.id)),
        ...(editing?.otherItemIds ?? []),
      ],
    };
    try {
      if (props.mode === "create") {
        const painting = await createPainting(identity);
        toast.success("Painting added");
        router.push(paintingHref(painting));
      } else {
        await updatePainting(props.painting.id, { ...identity, sourceRecordId }, props.fingerprint);
        toast.success("Painting saved");
        props.onSaved();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the painting";
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
    cancel: () => router.push("/paintings"),
    enabled: props.mode === "create" && !saving,
    track: true,
  });

  return (
    // ⌘Enter saves; on the create page this is the page's shortcut scope
    <>
    {unsavedPrompt}
    <div ref={root} className="space-y-8" data-shortcut-scope="">
      <Section title="Identity">
        <TitleInput
          label="Title"
          value={title}
          onValueChange={setTitle}
          placeholder="The Garden of Earthly Delights"
          maxLength={500}
          required
        />
        <PaintersField value={painters} onChange={setPainters} />
      </Section>

      <Section title="Date">
        <div className="max-w-md">
          <CatalogueDateField
            label="Painted"
            value={created}
            onChange={(value, err) => {
              setCreated(value);
              setDateError(err);
            }}
          />
        </div>
        {props.mode === "edit" && props.sources.length > 0 && (
          <div className="max-w-sm">
            <Select
              label="Source of this date"
              value={sourceRecordId ?? ""}
              placeholder="No source"
              onChange={(e) => setSourceRecordId(e.target.value || null)}
              options={props.sources.map((s) => ({ value: s.id, label: s.label }))}
            />
          </div>
        )}
      </Section>

      <Section title="Classification">
        <div className="space-y-2">
          <ChoiceListField
            label="Movements"
            noun="movements"
            choices={props.choices.movements}
            value={movements}
            onChange={setMovements}
          />
          {PAINTING_FAMILIES.map(({ key, label, family }) => (
            <TermListField
              key={key}
              label={label}
              family={family}
              value={classification[key]}
              onChange={(terms) => setClassification((c) => ({ ...c, [key]: terms }))}
            />
          ))}
        </div>
      </Section>

      <Section title="Description">
        <Textarea
          aria-label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={50000}
          placeholder="What it shows, how it came to be"
        />
      </Section>

      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      {/* In the edit dialog, under its body and always in view */}
      <DialogFooter outside="">
        <Button
          variant="ghost"
          data-dismiss=""
          onClick={() => (props.mode === "edit" ? props.onCancel() : router.push("/paintings"))}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} busy={saving} disabled={blocked}>
          {props.mode === "create" ? "Add painting" : "Save"}
        </Button>
      </DialogFooter>
    </div>
    </>
  );
}
