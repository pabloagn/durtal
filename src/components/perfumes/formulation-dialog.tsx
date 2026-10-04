"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import {
  createPerfumeVariant,
  updatePerfumeVariant,
} from "@/lib/actions/perfumes";
import { PERFUME_CONCENTRATIONS } from "@/lib/catalogue/perfumes";
import {
  CONCENTRATION_LABELS,
  type NotePosition,
  type PerfumeConcentration,
} from "@/lib/catalogue/perfume-labels";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import type { Attribution } from "@/lib/catalogue/credits";
import { TermListField, type TermEntry } from "@/components/catalogue/record-fields";
import {
  CreditListField,
  NotePyramidEditor,
  type CreditEntry,
  type NoteEntry,
} from "./perfume-fields";

/** A stored formulation, as the edit dialog starts from it */
export interface EditableFormulation {
  id: string;
  fingerprint: string;
  concentration: PerfumeConcentration | null;
  concentrationLabel: string | null;
  formulationLabel: string | null;
  releaseDate: CatalogueDateInput | null;
  discontinuedDate: CatalogueDateInput | null;
  notes: string | null;
  sourceRecordId: string | null;
  /** Its own perfumers, or null when it has the fragrance's */
  perfumers: CreditEntry[] | null;
  /** Its own notes, or null when it has the fragrance's */
  notePyramid: NoteEntry[] | null;
  /** Its own terms per vocabulary slug; a vocabulary left out is the fragrance's */
  classification: Record<string, TermEntry[]>;
}

/** The vocabularies a formulation can set on its own: families and accords */
export interface FormulationVocabulary {
  familyId: string;
  slug: string;
  name: string;
  label: string;
}

/** "Same as the fragrance" or the formulation's own values */
function OwnOrInherited({
  legend,
  own,
  onOwnChange,
  inheritedHint,
  children,
}: {
  legend: string;
  own: boolean;
  onOwnChange: (own: boolean) => void;
  inheritedHint: string;
  children: React.ReactNode;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="type-label mb-1.5">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
        <label className="flex items-center gap-2">
          <input type="radio" name={name} checked={!own} onChange={() => onOwnChange(false)} />
          Same as the fragrance
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={name} checked={own} onChange={() => onOwnChange(true)} />
          Its own
        </label>
      </div>
      {own ? children : <p className="text-xs text-fg-secondary">{inheritedHint}</p>}
    </fieldset>
  );
}

const CONCENTRATION_OPTIONS = [
  { value: "", label: "Unknown" },
  ...PERFUME_CONCENTRATIONS.map((c) => ({ value: c, label: CONCENTRATION_LABELS[c].label })),
];

/**
 * Adds or edits one formulation: a concentration as sold (Eau de Parfum,
 * Extrait), and a reformulation when one is known. Perfumers, notes,
 * families and accords are the fragrance's unless the formulation has its
 * own; "Its own" with nothing listed records that it has none.
 */
export function FormulationDialog({
  open,
  onClose,
  perfumeId,
  perfumeTitle,
  formulation,
  vocabularies,
  inherited,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  perfumeId: string;
  perfumeTitle: string;
  formulation?: EditableFormulation;
  vocabularies: FormulationVocabulary[];
  /** What "Same as the fragrance" means, for each section */
  inherited: { perfumers: string; notes: string; vocabularies: Record<string, string> };
  sources: { id: string; label: string }[];
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={formulation ? "Edit formulation" : "Add formulation"}
      description={perfumeTitle}
      className="max-w-3xl"
    >
      {open && (
        <FormulationForm
          perfumeId={perfumeId}
          formulation={formulation}
          vocabularies={vocabularies}
          inherited={inherited}
          sources={sources}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function FormulationForm({
  perfumeId,
  formulation,
  vocabularies,
  inherited,
  sources,
  onDone,
}: {
  perfumeId: string;
  formulation?: EditableFormulation;
  vocabularies: FormulationVocabulary[];
  inherited: { perfumers: string; notes: string; vocabularies: Record<string, string> };
  sources: { id: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [concentration, setConcentration] = useState<PerfumeConcentration | null>(
    formulation?.concentration ?? null,
  );
  const [concentrationLabel, setConcentrationLabel] = useState(formulation?.concentrationLabel ?? "");
  const [formulationLabel, setFormulationLabel] = useState(formulation?.formulationLabel ?? "");
  const [release, setRelease] = useState(formulation?.releaseDate ?? null);
  const [discontinued, setDiscontinued] = useState(formulation?.discontinuedDate ?? null);
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [ownPerfumers, setOwnPerfumers] = useState(!!formulation?.perfumers);
  const [perfumers, setPerfumers] = useState<CreditEntry[]>(formulation?.perfumers ?? []);
  const [ownNotes, setOwnNotes] = useState(!!formulation?.notePyramid);
  const [notePyramid, setNotePyramid] = useState<NoteEntry[]>(formulation?.notePyramid ?? []);
  const [own, setOwn] = useState<Record<string, TermEntry[] | null>>(
    Object.fromEntries(
      vocabularies.map((v) => [v.slug, formulation?.classification[v.slug] ?? null]),
    ),
  );
  const [about, setAbout] = useState(formulation?.notes ?? "");
  const [sourceRecordId, setSourceRecordId] = useState(formulation?.sourceRecordId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otherWithoutName = concentration === "other" && !concentrationLabel.trim();
  const blocked = otherWithoutName || Object.values(dateErrors).some(Boolean);

  async function save() {
    if (blocked || saving) return;
    setSaving(true);
    setError(null);
    const fields = {
      concentration,
      concentrationLabel: concentrationLabel.trim() || null,
      formulationLabel: formulationLabel.trim() || null,
      releaseDate: release,
      discontinuedDate: discontinued,
      notes: about.trim() || null,
      sourceRecordId,
      perfumers: ownPerfumers
        ? perfumers.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            personId: p.personId,
            creditedAs: p.creditedAs,
            attribution: p.attribution as Attribution,
            sourceRecordId: p.sourceRecordId ?? null,
            notes: p.notes ?? null,
          }))
        : null,
      notePyramid: ownNotes
        ? notePyramid.map(({ itemId, position, sourceRecordId: source }) => ({
            itemId,
            position: position as NotePosition,
            sourceRecordId: source,
          }))
        : null,
      classification: vocabularies.flatMap((v) =>
        own[v.slug] ? [{ familyId: v.familyId, itemIds: own[v.slug]!.map((t) => t.id) }] : [],
      ),
    };
    try {
      if (formulation) await updatePerfumeVariant(formulation.id, fields, formulation.fingerprint);
      else await createPerfumeVariant({ workId: perfumeId, ...fields });
      toast.success(formulation ? "Formulation saved" : "Formulation added");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the formulation";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Select
          label="Concentration"
          value={concentration ?? ""}
          onChange={(e) =>
            setConcentration((e.target.value || null) as PerfumeConcentration | null)
          }
          options={CONCENTRATION_OPTIONS}
        />
        <Input
          label={concentration === "other" ? "Its name" : "Qualifier"}
          value={concentrationLabel}
          onChange={(e) => setConcentrationLabel(e.target.value)}
          placeholder={concentration === "other" ? "Hair mist" : "Intense"}
          maxLength={200}
          error={otherWithoutName ? "Name the other concentration" : undefined}
        />
        <Input
          label="Formulation"
          value={formulationLabel}
          onChange={(e) => setFormulationLabel(e.target.value)}
          placeholder="2014 reformulation"
          maxLength={200}
        />
      </div>

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

      <OwnOrInherited
        legend="Perfumers"
        own={ownPerfumers}
        onOwnChange={setOwnPerfumers}
        inheritedHint={inherited.perfumers}
      >
        <CreditListField label="Perfumers" value={perfumers} onChange={setPerfumers} />
      </OwnOrInherited>

      <OwnOrInherited
        legend="Notes"
        own={ownNotes}
        onOwnChange={setOwnNotes}
        inheritedHint={inherited.notes}
      >
        <NotePyramidEditor value={notePyramid} onChange={setNotePyramid} />
      </OwnOrInherited>

      {vocabularies.map((v) => (
        <OwnOrInherited
          key={v.slug}
          legend={v.label}
          own={own[v.slug] !== null}
          onOwnChange={(isOwn) =>
            setOwn((current) => ({ ...current, [v.slug]: isOwn ? (current[v.slug] ?? []) : null }))
          }
          inheritedHint={inherited.vocabularies[v.slug] ?? "None"}
        >
          <TermListField
            label={v.label}
            family={{ slug: v.slug, name: v.name }}
            value={own[v.slug] ?? []}
            onChange={(terms) => setOwn((current) => ({ ...current, [v.slug]: terms }))}
          />
        </OwnOrInherited>
      ))}

      <Textarea
        label="About this formulation"
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        rows={3}
        maxLength={10000}
        placeholder="How it differs, where it was sold"
      />

      {sources.length > 0 && (
        <div className="max-w-sm">
          <Select
            label="Source"
            value={sourceRecordId ?? ""}
            placeholder="No source"
            onChange={(e) => setSourceRecordId(e.target.value || null)}
            options={sources.map((s) => ({ value: s.id, label: s.label }))}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} disabled={blocked || saving}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {formulation ? "Save" : "Add formulation"}
        </Button>
      </div>
    </div>
  );
}
