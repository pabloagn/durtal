"use client";

import { copyBookText } from "@/lib/utils/copy-book";
import { useState } from "react";
import dynamic from "next/dynamic";
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
import { toast } from "@/lib/notifications/toast";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { useEditActions } from "@/components/shortcuts/shortcuts-provider";
import { EDIT_KEYS, editHint } from "@/lib/shortcuts/shortcuts";
import { ExportMenu } from "@/components/shared/export-menu";
import { WorkEditDialog } from "./work-edit-dialog";
import { WorkTaxonomyEditDialog } from "./work-taxonomy-edit-dialog";
import { MediaManagerDialog } from "@/components/media/media-manager-dialog";
import { EditionAddDialog } from "./edition-add-dialog";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { WorkRelationDialog } from "@/components/catalogue/work-relations";
import { getWorkDeleteSummary } from "@/lib/actions/works";
const LinkEbookDialog = dynamic(() => import("@/components/ebooks/link-ebook-dialog").then((module) => module.LinkEbookDialog), { ssr: false });
const WorkReviewDialog = dynamic(() => import("@/components/ebooks/work-review-dialog").then((module) => module.WorkReviewDialog), { ssr: false });
import type { WorkReviewOutcome } from "@/lib/ebooks/review/work-service";
import { workDeleteCascade } from "@/lib/catalogue/delete-cascade";
import { useDeleteSummary } from "@/components/books/use-delete-summary";
import { preloadEditOptions } from "@/hooks/use-edit-options";
import { EDIT_OPTION_GROUPS, type EditOption, type TaxonomyGroup } from "@/lib/catalogue/edit-options";
import { deleteWork } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

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
  /** What Edit work saves against (SLN-1243) */
  fingerprint: string | null;
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
  hasLinkedEbook?: boolean;
  /** The reading history the delete removes */
  posterCount: number;
  backgroundCount: number;
  galleryCount: number;
  chosen: ChosenOptions;
}

export function WorkActionsMenu({
  work,
  workAuthors,
  authorName: _authorName,
  hasLinkedEbook = false,
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
  const [ebookLinkOpen, setEbookLinkOpen] = useState(false);
  const [statusReviewOpen, setStatusReviewOpen] = useState(false);
  const [statusOutcome, setStatusOutcome] = useState<WorkReviewOutcome | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteSummary = useDeleteSummary(deleteOpen, work.id, () => getWorkDeleteSummary([work.id]));
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
      toast.success("Book deleted");
      router.push("/library");
    } catch (error) {
      toast.error(refusalMessage(error, "Could not delete the book. Try again."));
    }
  }

  const reading = useOptionalReading();
  const actionItems = [
    {
      label: copied ? "Copied!" : "Copy",
      icon: copied ? Check : Copy,
      onClick: handleCopy,
    },
    {
      label: "Edit work",
      icon: Pencil,
      onClick: () => setEditOpen(true),
      shortcut: editHint(EDIT_KEYS.work),
    },
    {
      label: "Edit taxonomy",
      icon: Tag,
      onClick: () => setTaxonomyOpen(true),
      shortcut: editHint(EDIT_KEYS.taxonomy),
    },
    {
      label: "Manage media",
      icon: ImageIcon,
      onClick: () => setMediaOpen(true),
      shortcut: editHint(EDIT_KEYS.media),
    },
    // With no readings yet, the Reading section is not shown: its first steps are here
    ...(reading && reading.data.rows.length === 0
      ? [
          { label: "Start reading", icon: BookPlus, onClick: () => reading.run("start"), shortcut: "R S" },
          { label: "Log a past read", icon: CalendarClock, onClick: () => reading.run("past"), shortcut: "R L" },
        ]
      : []),
    // Up next (SLN-452), while no reading is open
    ...(reading?.queuable
      ? [
          reading.data.queuePlace
            ? { label: `In Up next, ${ordinal(reading.data.queuePlace)} · Remove`, icon: ListMinus, onClick: () => void reading.toggleQueue(), shortcut: "R N" }
            : { label: "Add to Up next", icon: ListPlus, onClick: () => void reading.toggleQueue(), shortcut: "R N" },
        ]
      : []),
    {
      label: "Add edition",
      icon: Plus,
      onClick: () => setAddEditionOpen(true),
    },
    {
      label: "Link a work",
      icon: Link2,
      onClick: () => setLinkOpen(true),
    },
    {
      label: "Link an eBook…",
      icon: BookPlus,
      onClick: () => setEbookLinkOpen(true),
    },
    ...(statusOutcome?.undo.available ? [{ label: "Undo book status change…", icon: BookPlus, onClick: () => setStatusReviewOpen(true) }] :
      hasLinkedEbook && ["tracked", "shortlisted", "wanted", "on_order"].includes(work.catalogueStatus)
        ? [{ label: "Mark book accessioned…", icon: BookPlus, onClick: () => setStatusReviewOpen(true) }] : []),
    {
      label: "Delete work",
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
      {ebookLinkOpen && <LinkEbookDialog workId={work.id} workTitle={work.title} onClose={() => setEbookLinkOpen(false)} />}
      {statusReviewOpen && <WorkReviewDialog work={{ id: work.id, title: work.title, status: work.catalogueStatus }} original={statusOutcome ?? undefined}
        onClose={() => setStatusReviewOpen(false)} onCommitted={(outcome) => { setStatusOutcome(outcome); router.refresh();
          toast.success(outcome.message, { duration: 10_000, action: { label: "Undo", onClick: () => setStatusReviewOpen(true) } }); }}
        onUndone={(outcome) => { setStatusOutcome(null); router.refresh(); toast.success(outcome.message); }} />}

      <DeleteConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete work"
        description="This cannot be undone."
        itemName={work.title}
        cascade={workDeleteCascade(deleteSummary)}
        refusal={deleteSummary?.refusal}
      />
    </>
  );
}
