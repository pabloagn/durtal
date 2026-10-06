"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GripVertical, MoreHorizontal } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { moveQueueItem, removeFromQueue, restoreQueueItem } from "@/lib/actions/reading-queue";
import { showError, undoToast } from "./reading-client";
import { useReadingDialogs } from "./reading-dialogs-provider";
import { Cover } from "./reading-tiles";

/*
 * The Up Next list (SLN-452): drag a row by its handle, or lift it with the
 * keyboard (Space, the arrows, Space), or use the row menu. Each move saves
 * at once and says where the book went. Start reading opens the Start
 * dialog with the queued edition.
 */

export interface QueueRow {
  workId: string;
  /** Its place in all of Up Next, 1 for the top: what a filtered list shows */
  place: number;
  title: string;
  href: string;
  author: string | null;
  cover: string | null;
  /** The edition to start with: the queued one, else the default */
  editionId: string | null;
  /** "320 p. · On your shelf in Amsterdam · About 9 h" */
  line: string;
  note: string | null;
  /** "Added 3 Oct · Read in 2012" */
  added: string;
}

function placeWords(title: string, place: number, total: number) {
  return `${title} moved to position ${place} of ${total}`;
}

function Row({
  row,
  index,
  shownPlace,
  total,
  onMove,
  onTop,
  onRemove,
}: {
  row: QueueRow;
  /** Its place among the rows shown, 1 for the first */
  index: number;
  /** The number it shows: its place in all of Up Next under a filter, else its index */
  shownPlace: number;
  total: number;
  onMove: (workId: string, to: number) => void;
  onTop: (workId: string) => void;
  onRemove: (row: QueueRow) => void;
}) {
  const { open } = useReadingDialogs();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.workId });
  const handleLabel = `Move ${row.title}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-3 border-t border-glass-border px-2 py-3 first:border-t-0 ${isDragging ? "relative z-10 bg-bg-secondary" : ""}`}
      data-queue-row={row.workId}
    >
      <CapAligned height={32} coarseHeight={44} className="text-sm">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={handleLabel}
          data-tooltip="Drag, or press Space and the arrows"
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded-sm text-fg-secondary transition-colors hover:text-fg-primary active:cursor-grabbing pointer-coarse:h-11 pointer-coarse:w-11"
          data-queue-handle=""
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </CapAligned>
      <span className="w-6 shrink-0 text-right text-sm tabular-nums text-fg-secondary" data-queue-place="">
        {shownPlace}
      </span>
      <Cover s3Key={row.cover} className="h-16 w-11" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link href={row.href} className="lines-1 text-sm text-fg-primary transition-colors hover:text-accent-rose-text">
          {row.title}
        </Link>
        {row.author && <p className="lines-1 text-xs text-fg-secondary">{row.author}</p>}
        <p className="text-xs text-fg-secondary">{row.line}</p>
        {row.note && <p className="text-xs italic text-fg-secondary">{row.note}</p>}
        <p className="text-xs text-fg-secondary">{row.added}</p>
      </div>
      <CapAlignedControls height={32} coarseHeight={44} className="text-sm">
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="pointer-coarse:h-11"
            onClick={() => void open({ kind: "start", workId: row.workId, editionId: row.editionId })}
            data-queue-start={row.workId}
          >
            Start reading
          </Button>
          <DropdownMenu
            align="end"
            trigger={
              <button
                type="button"
                aria-label={`More for ${row.title}`}
                data-tooltip="More"
                className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary pointer-coarse:h-11 pointer-coarse:w-11"
                data-queue-menu={row.workId}
              >
                <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
              </button>
            }
          >
            {shownPlace > 1 && <DropdownMenuItem onClick={() => onTop(row.workId)}>Move to top</DropdownMenuItem>}
            {index > 1 && <DropdownMenuItem onClick={() => onMove(row.workId, index - 1)}>Move up</DropdownMenuItem>}
            {index < total && <DropdownMenuItem onClick={() => onMove(row.workId, index + 1)}>Move down</DropdownMenuItem>}
            {total > 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="danger" onClick={() => onRemove(row)}>
              Remove from Up Next
            </DropdownMenuItem>
          </DropdownMenu>
        </span>
      </CapAlignedControls>
    </li>
  );
}

/**
 * `filtered`: the rows are a part of Up Next (At hand): each shows its place
 * in the whole list, and Move to top puts the book above every other one.
 */
export function QueueList({ rows: initial, filtered = false }: { rows: QueueRow[]; filtered?: boolean }) {
  const router = useRouter();
  // The order on screen; a refresh with new rows replaces it
  const [shown, setShown] = useState({ from: initial, rows: initial });
  const rows = shown.from === initial ? shown.rows : initial;
  const setRows = (next: QueueRow[]) => setShown({ from: initial, rows: next });
  const [said, setSaid] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const titleOf = (id: string | number) => rows.find((r) => r.workId === id)?.title ?? "The book";
  const indexOf = (id: string | number) => rows.findIndex((r) => r.workId === id);

  const changed = () => {
    router.refresh();
    triggerActivityRefresh();
  };

  /**
   * Saves the row at its new index, between its new neighbours (none: the top
   * of all of Up Next); puts it back on a refusal
   */
  async function save(workId: string, from: number, to: number, top = false) {
    // The first row shown under a filter may still go to the top of all of Up Next
    if (from === to && !top) return;
    const before = rows;
    const next = arrayMove(rows, from, to);
    setRows(next);
    const message = placeWords(next[to].title, to + 1, next.length);
    setSaid(message);
    try {
      await moveQueueItem(
        top
          ? { workId, afterWorkId: null, beforeWorkId: null }
          : { workId, afterWorkId: next[to - 1]?.workId ?? null, beforeWorkId: next[to + 1]?.workId ?? null },
      );
      changed();
    } catch (err) {
      setRows(before);
      showError(err, changed);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    void save(String(event.active.id), indexOf(event.active.id), indexOf(event.over.id));
  }

  async function remove(row: QueueRow) {
    try {
      const removed = await removeFromQueue({ workId: row.workId });
      setRows(rows.filter((r) => r.workId !== row.workId));
      changed();
      undoToast(`Removed ${row.title} from Up Next`, async () => {
        try {
          await restoreQueueItem(removed);
          changed();
        } catch (err) {
          showError(err, changed);
        }
      });
    } catch (err) {
      showError(err, changed);
    }
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}, position ${indexOf(active.id) + 1} of ${rows.length}`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over position ${indexOf(over.id) + 1} of ${rows.length}` : undefined),
    onDragEnd: ({ active, over }) => (over ? placeWords(titleOf(active.id), indexOf(over.id) + 1, rows.length) : `${titleOf(active.id)} was dropped`),
    onDragCancel: ({ active }) => `${titleOf(active.id)} stays at position ${indexOf(active.id) + 1}`,
  };

  return (
    <>
      <DndContext
        // A fixed id: dnd-kit's own counter gives the server and the browser different aria-describedby ids
        id="up-next"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: "Press Space to lift a book, the arrow keys to move it, Space to drop it, Escape to cancel." } }}
      >
        <SortableContext items={rows.map((r) => r.workId)} strategy={verticalListSortingStrategy}>
          <ol className="rounded-sm border border-glass-border" data-queue-list="">
            {rows.map((row, i) => (
              <Row
                key={row.workId}
                row={row}
                index={i + 1}
                shownPlace={filtered ? row.place : i + 1}
                total={rows.length}
                onMove={(id, to) => void save(id, i, to - 1)}
                onTop={(id) => void save(id, i, 0, true)}
                onRemove={(r) => void remove(r)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="sr-only" aria-live="polite" data-queue-said="">
        {said}
      </p>
    </>
  );
}
