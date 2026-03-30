"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Check,
  Pencil,
  Tag,
  ImageIcon,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EntityActionMenu } from "@/components/shared/entity-action-menu";
import { ExportMenu } from "@/components/shared/export-menu";
import { WorkEditDialog } from "./work-edit-dialog";
import { WorkTaxonomyEditDialog } from "./work-taxonomy-edit-dialog";
import { MediaManagerDialog } from "@/components/books/media-manager-dialog";
import { EditionAddDialog } from "./edition-add-dialog";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { deleteWork } from "@/lib/actions/works";

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
  recommenderIds: string[];
}

interface WorkAuthorRow {
  id: string;
  name: string;
  role: string;
}

interface TaxonomyIds {
  subjectIds: string[];
  categoryIds: string[];
  themeIds: string[];
  literaryMovementIds: string[];
  artTypeIds: string[];
  artMovementIds: string[];
  keywordIds: string[];
  attributeIds: string[];
}

interface TaxonomyOptions {
  subjects: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  themes: { id: string; name: string }[];
  literaryMovements: { id: string; name: string }[];
  artTypes: { id: string; name: string }[];
  artMovements: { id: string; name: string }[];
  keywords: { id: string; name: string }[];
  attributes: { id: string; name: string }[];
}

interface WorkActionsMenuProps {
  work: WorkData;
  workAuthors: WorkAuthorRow[];
  authorName: string;
  editionCount: number;
  instanceCount: number;
  posterCount: number;
  backgroundCount: number;
  galleryCount: number;
  taxonomyIds: TaxonomyIds;
  availableAuthors: { id: string; name: string }[];
  availableSeries: { id: string; title: string }[];
  availableWorkTypes: { id: string; name: string }[];
  availableRecommenders: { id: string; name: string }[];
  availableGenres: { id: string; name: string }[];
  availableTags: { id: string; name: string }[];
  taxonomyOptions: TaxonomyOptions;
}

export function WorkActionsMenu({
  work,
  workAuthors,
  authorName,
  editionCount,
  instanceCount,
  posterCount,
  backgroundCount,
  galleryCount,
  taxonomyIds,
  availableAuthors,
  availableSeries,
  availableWorkTypes,
  availableRecommenders,
  availableGenres,
  availableTags,
  taxonomyOptions,
}: WorkActionsMenuProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [addEditionOpen, setAddEditionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(`${work.title}, ${authorName}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
    const parts: string[] = [];
    if (editionCount > 0)
      parts.push(`${editionCount} edition${editionCount === 1 ? "" : "s"}`);
    if (instanceCount > 0)
      parts.push(`${instanceCount} instance${instanceCount === 1 ? "" : "s"}`);
    if (parts.length === 0) return undefined;
    return `This will also delete ${parts.join(" and ")}.`;
  }

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
    },
    {
      label: "Edit Taxonomy",
      icon: Tag,
      onClick: () => setTaxonomyOpen(true),
    },
    {
      label: "Manage Media",
      icon: ImageIcon,
      onClick: () => setMediaOpen(true),
    },
    {
      label: "Add Edition",
      icon: Plus,
      onClick: () => setAddEditionOpen(true),
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
          size="sm"
        />
        <EntityActionMenu items={actionItems} />
      </div>

      <WorkEditDialog
        work={work}
        authors={workAuthors}
        availableAuthors={availableAuthors}
        availableSeries={availableSeries}
        availableWorkTypes={availableWorkTypes}
        availableRecommenders={availableRecommenders}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <WorkTaxonomyEditDialog
        workId={work.id}
        currentSubjectIds={taxonomyIds.subjectIds}
        currentCategoryIds={taxonomyIds.categoryIds}
        currentThemeIds={taxonomyIds.themeIds}
        currentLiteraryMovementIds={taxonomyIds.literaryMovementIds}
        currentArtTypeIds={taxonomyIds.artTypeIds}
        currentArtMovementIds={taxonomyIds.artMovementIds}
        currentKeywordIds={taxonomyIds.keywordIds}
        currentAttributeIds={taxonomyIds.attributeIds}
        subjects={taxonomyOptions.subjects}
        categories={taxonomyOptions.categories}
        themes={taxonomyOptions.themes}
        literaryMovements={taxonomyOptions.literaryMovements}
        artTypes={taxonomyOptions.artTypes}
        artMovements={taxonomyOptions.artMovements}
        keywords={taxonomyOptions.keywords}
        attributes={taxonomyOptions.attributes}
        open={taxonomyOpen}
        onOpenChange={setTaxonomyOpen}
      />

      <MediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        workId={work.id}
        title={work.title}
      />

      <EditionAddDialog
        workId={work.id}
        workTitle={work.title}
        availableAuthors={availableAuthors}
        availableGenres={availableGenres}
        availableTags={availableTags}
        open={addEditionOpen}
        onOpenChange={setAddEditionOpen}
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
