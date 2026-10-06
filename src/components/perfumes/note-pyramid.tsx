import {
  NOTE_POSITION_LABELS,
  notesByPosition,
  type NotePosition,
} from "@/lib/catalogue/perfume-labels";

export interface PyramidNote {
  itemId: string;
  name: string;
  position: NotePosition | null;
}

/**
 * The note pyramid, read: top, heart and base on their own lines, then the
 * notes no source placed. A perfume with no notes says so.
 */
export function NotePyramid({ notes }: { notes: PyramidNote[] }) {
  const groups = notesByPosition(notes);
  if (!groups.length)
    return <p className="text-sm text-fg-secondary">No notes recorded</p>;
  const placed = groups.some((g) => g.position !== "unspecified");
  // Sources that place one note differently are both kept: say so
  const places = new Map<string, { name: string; positions: NotePosition[] }>();
  for (const note of notes) {
    if (!note.position || note.position === "unspecified") continue;
    const entry = places.get(note.itemId) ?? { name: note.name, positions: [] };
    if (!entry.positions.includes(note.position))
      entry.positions.push(note.position);
    places.set(note.itemId, entry);
  }
  const disputed = [...places.values()].filter((p) => p.positions.length > 1);
  return (
    <>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5">
        {groups.map(({ position, notes: list }) => (
          <div key={position} className="contents">
            <dt className="type-caption leading-6">
              {/* Beside a pyramid, notes with no place are the "other" ones */}
              {position === "unspecified" && placed
                ? "Other"
                : NOTE_POSITION_LABELS[position]}
            </dt>
            <dd className="text-sm leading-6 text-fg-primary">
              {list.map((note, i) => (
                <span key={note.itemId}>
                  {i > 0 && (
                    <>
                      <span className="text-fg-secondary" aria-hidden>
                        {" · "}
                      </span>
                      <span className="sr-only">, </span>
                    </>
                  )}
                  {note.name}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      {disputed.length > 0 && (
        <p className="mt-2.5 text-xs text-fg-secondary">
          Placed in more than one tier by its sources:{" "}
          {disputed
            .map(
              (d) =>
                `${d.name} (${d.positions.map((p) => NOTE_POSITION_LABELS[p].toLowerCase()).join(", ")})`,
            )
            .join("; ")}
        </p>
      )}
    </>
  );
}
