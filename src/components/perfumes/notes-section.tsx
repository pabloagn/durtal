"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SectionHeading } from "@/components/shared/section-heading";
import { updatePerfume } from "@/lib/actions/perfumes";
import type { NotePosition } from "@/lib/catalogue/perfume-labels";
import { NotePyramid } from "./note-pyramid";
import { NotePyramidEditor, type NoteEntry } from "./perfume-fields";

export interface SectionNote {
  itemId: string;
  name: string;
  position: NotePosition | null;
  sourceRecordId: string | null;
}

/**
 * The note pyramid of the fragrance, or of the formulation chosen on the
 * page. The fragrance's own pyramid is edited here; a formulation's is
 * edited with the formulation, so this section only shows it.
 */
export function NotesSection({
  perfumeId,
  fingerprint,
  notes,
  editable,
  scope,
  sources = [],
}: {
  perfumeId: string;
  fingerprint: string;
  notes: SectionNote[];
  editable: boolean;
  /** Which notes these are, when a formulation is chosen */
  scope?: string;
  /** The perfume's sources, to cite one for the notes added */
  sources?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoteEntry[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Notes added now cite the chosen source; notes already there keep theirs.
   * Two sources can place one note differently: each placement stays, with
   * its own source, until the person removes one.
   */
  function change(next: NoteEntry[]) {
    const known = new Set(draft.map((n) => `${n.itemId}:${n.position}`));
    setDraft(next.map((n) => (known.has(`${n.itemId}:${n.position}`) ? n : { ...n, sourceRecordId: source })));
  }

  function startEditing() {
    setDraft(
      notes.map((n) => ({
        itemId: n.itemId,
        name: n.name,
        parentName: null,
        position: n.position ?? "unspecified",
        sourceRecordId: n.sourceRecordId,
      })),
    );
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      await updatePerfume(
        perfumeId,
        {
          notePyramid: draft.map(({ itemId, position, sourceRecordId }) => ({
            itemId,
            position,
            sourceRecordId,
          })),
        },
        fingerprint,
      );
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the notes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-10" aria-labelledby="perfume-notes">
      <SectionHeading
        id="perfume-notes"
        title="Notes"
        description={scope}
        action={
          editable &&
          !editing && (
            <Button variant="ghost" size="sm" onClick={startEditing}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              Edit
            </Button>
          )
        }
      />
      {editing ? (
        <div className="space-y-4" data-shortcut-scope="">
          {sources.length > 0 && (
            <div className="max-w-sm">
              <Select
                label="Source of the notes you add"
                value={source ?? ""}
                placeholder="No source"
                onChange={(e) => setSource(e.target.value || null)}
                options={sources.map((s) => ({ value: s.id, label: s.label }))}
              />
            </div>
          )}
          <NotePyramidEditor value={draft} onChange={change} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" data-shortcut="save" disabled={saving} onClick={save}>
              Save notes
            </Button>
          </div>
        </div>
      ) : (
        <NotePyramid notes={notes} />
      )}
    </section>
  );
}
