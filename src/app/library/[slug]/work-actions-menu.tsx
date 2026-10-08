"use client";

import { copyBookText } from "@/lib/utils/copy-book";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Check,
  Pencil,
  Tag,
  ImageIcon,
  Link2,
  Plus,
  Trash2,
  BookPlus,
  CalendarClock,
  ListMinus,
  ListPlus,
} from "lucide-react";
import { useOptionalReading } from "@/components/reading/reading-provider";
import { ordinal } from "@/lib/reading/queue";
import { toast } from "sonner";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS } from "@/lib/shortcuts/shortcuts";
import { ExportMenu } from "@/components/shared/export-menu";
import { WorkEditDialog } from "./work-edit-dialog";
import { WorkTaxonomyEditDialog } from "./work-taxonomy-edit-dialog";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { EditionAddDialog } from "./edition-add-dialog";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { WorkRelationDialog } from "@/components/catalogue/work-relations";
import { deleteWork } from "@/lib/actions/works";
import { workDeleteCascadeMessage } from "@/components/books/delete-cascade";
import { preloadEditOptions } from "@/hooks/use-edit-options";
import { EDIT_OPTION_GROUPS, type EditOption, type TaxonomyGroup } from "@/lib/catalogue/edit-options";

/* ── Prop types (mirrors the server component's data shapes) ─────────────── */

interface WorkData {
  id: string;
  slug: string;
  title: string;
  originalLanguage: string;
  originalYear: number | null;
  description: string | null;
  seriesName: string | null;
  seriesPosition: string | null;
  seriesId: string | null;
  isAnthology: boolean;
  workTypeId: string | null;
  notes: string | null;
  rating: number | null;
  catalogueStatus: string;
  acquisitionPriority: string;
  goodreadsUrl: string | null;
  storygraphUrl: string | null;
  recommenderIds: string[];
}

interface WorkAuthorRow {
  id: string;
  name: string;
  role: string;
}

/** The work's own choices, shown at once; every list loads when its dialog opens (SLN-510) */
interface ChosenOptions extends Record<TaxonomyGroup, EditOption[]> {
  series: EditOption[];
  workTypes: EditOption[];
  recommenders: EditOption[];
}

interface WorkActionsMenuProps {
  work: WorkData;
  workAuthors: WorkAuthorRow[];
  authorName: string;
  editionCount: number;
  instanceCount: number;
  /** The reading history the delete removes */
  readingCounts?: { readings: number; sessions: number; quotes?: number; notes?: number };
  posterCount: number;
  backgroundCount: number;
  galleryCount: number;
  chosen: ChosenOptions;
}

export function WorkActionsMenu({
  work,
  workAuthors,
  authorName: _authorName,
  editionCount,
  instanceCount,
  readingCounts,
  posterCount: _posterCount,
  backgroundCount: _backgroundCount,
  galleryCount: _galleryCount,
  chosen,
}: WorkActionsMenuProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [addEditionOpen, setAddEditionOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // E then W, M or T (the Edit menu)
  useEditActions([
    { key: EDIT_KEYS.work, label: "Work", icon: Pencil, run: () => setEditOpen(true) },
    { key: EDIT_KEYS.media, label: "Media", icon: ImageIcon, run: () => setMediaOpen(true) },
    { key: EDIT_KEYS.taxonomy, label: "Taxonomy", icon: Tag, run: () => setTaxonomyOpen(true) },
  ]);

  async function handleCopy() {
    try {
      await copyBookText(work.title, workAuthors.map((a) => a.name));
      setCopied(true);
      toast.success("Book title and author copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy. Allow clipboard access and try again.");
    }
  }

  async function handleDelete() {
    try {
      await deleteWork(work.id);
      toast.success("Work deleted");
      router.push("/library");
    } catch {
      toast.error("Failed to delete work");
    }
  }

  function buildCascadeMessage(): string | undefined {
    return workDeleteCascadeMessage({
      editions: editionCount,
      instances: instanceCount,
      readings: readingCounts?.readings ?? 0,
      sessions: readingCounts?.sessions ?? 0,
      quotes: readingCounts?.quotes ?? 0,
      notes: readingCounts?.notes ?? 0,
    });
  }

  const reading = useOptionalReading();
  const actionItems = [
    {
      label: copied ? "Copied!" : "Copy",
      icon: copied ? Check : Copy,
      onClick: handleCopy,
    },
    {
      label: "Edit Work",
      icon: Pencil,
      onClick: () => setEditOpen(true),
      shortcut: "E W",
    },
    {
      label: "Edit Taxonomy",
      icon: Tag,
      onClick: () => setTaxonomyOpen(true),
      shortcut: "E T",
    },
    {
      label: "Manage Media",
      icon: ImageIcon,
      onClick: () => setMediaOpen(true),
      shortcut: "E M",
    },
    // With no readings yet, the Reading section is not shown: its first steps are here
    ...(reading && reading.data.rows.length === 0
      ? [
          { label: "Start reading", icon: BookPlus, onClick: () => reading.run("start"), shortcut: "R S" },
          { label: "Log a past read", icon: CalendarClock, onClick: () => reading.run("past"), shortcut: "R L" },
        ]
      : []),
    // Up Next (SLN-452), while no reading is open
    ...(reading?.queuable
      ? [
          reading.data.queuePlace
            ? { label: `In Up Next, ${ordinal(reading.data.queuePlace)} · Remove`, icon: ListMinus, onClick: () => void reading.toggleQueue(), shortcut: "R N" }
            : { label: "Add to Up Next", icon: ListPlus, onClick: () => void reading.toggleQueue(), shortcut: "R N" },
        ]
      : []),
    {
      label: "Add Edition",
      icon: Plus,
      onClick: () => setAddEditionOpen(true),
    },
    {
      label: "Link a Work",
      icon: Link2,
      onClick: () => setLinkOpen(true),
    },
    {
      label: "Delete Work",
      icon: Trash2,
      onClick: () => setDeleteOpen(true),
      variant: "destructive" as const,
    },
  ];

  return (
    <>
      <div className="flex items-center gap-2">
        <ExportMenu
          entity="works"
          ids={[work.id]}
          side="bottom"
          align="end"
          size="md"
        />
        {/* A hand on the menu starts its dialogs' lists, so they open full */}
        <div
          className="contents"
          onPointerEnter={() => preloadEditOptions(EDIT_OPTION_GROUPS)}
          onFocus={() => preloadEditOptions(EDIT_OPTION_GROUPS)}
        >
          <EntityActionMenu items={actionItems} />
        </div>
      </div>

      <WorkEditDialog
        work={work}
        authors={workAuthors}
        chosen={chosen}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <WorkTaxonomyEditDialog
        workId={work.id}
        chosen={chosen}
        open={taxonomyOpen}
        onOpenChange={setTaxonomyOpen}
      />

      <MediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        entityId={work.id}
        title={work.title}
      />

      <EditionAddDialog
        workId={work.id}
        workTitle={work.title}
        open={addEditionOpen}
        onOpenChange={setAddEditionOpen}
      />

      <WorkRelationDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        work={{ id: work.id, kind: "book", title: work.title }}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete work"
        description="Are you sure you want to delete this work? This action cannot be undone."
        itemName={work.title}
        cascade={buildCascadeMessage()}
      />
    </>
  );
}
