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
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5">
      {groups.map(({ position, notes: list }) => (
        <div key={position} className="contents">
          <dt className="type-caption leading-6">
            {/* Beside a pyramid, notes with no place are the "other" ones */}
            {position === "unspecified" && placed ? "Other" : NOTE_POSITION_LABELS[position]}
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
  );
}
