"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, X, Check, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UploadZone } from "@/components/media/upload-zone";
import { LogoCardUpload, type LogoSource } from "@/components/media/logo-card-upload";
import { isLogoCard, parseLogoCardOptions } from "@/lib/media/logo-card-options";
import {
  getMediaByType,
  setActiveMedia,
  deleteMedia,
  bulkDeleteMedia,
} from "@/lib/actions/media";
import { ImageAdjustmentEditor, ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { ImageDetailsEditor } from "@/components/media/image-details-editor";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { DeleteConfirmDialog } from "@/app/library/[slug]/delete-confirm-dialog";
import { toast } from "sonner";

type TabType = "poster" | "background" | "gallery";

interface MediaItem {
  id: string;
  type: string;
  s3Key: string;
  thumbnailS3Key: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  isActive: boolean;
  sortOrder: number;
  caption: string | null;
  altText: string | null;
  credit: string | null;
  license: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
  cropX: number;
  cropY: number;
  cropZoom: number;
  /** A logo card's switches live here (SLN-441) */
  processingParams?: unknown;
  brightness: number;
  contrast: number;
  createdAt: Date;
}

interface MediaManagerDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Owner of the images: a work (poster, background, gallery), a collection
   * (poster, background), a perfume formulation (image, gallery) or a
   * publishing house (logo, background)
   */
  entityType?: "work" | "collection" | "perfume_variant" | "organization";
  entityId: string;
  title: string;
  /** Which tab to open on: defaults to "poster" */
  initialTab?: TabType;
  /**
   * The frame of the main image. "square" (perfumes): the whole image is
   * shown, never cropped, and it is called "Image"; such owners use no
   * background.
   */
  slot?: "portrait" | "square";
}

const TABS: { key: TabType; label: string }[] = [
  { key: "poster", label: "Poster" },
  { key: "background", label: "Background" },
  { key: "gallery", label: "Gallery" },
];

const COLLECTION_TABS = TABS.filter((tab) => tab.key !== "gallery");

const SQUARE_TABS: { key: TabType; label: string }[] = [
  { key: "poster", label: "Image" },
  { key: "gallery", label: "Gallery" },
];

/** A publishing house: its logo, shown whole, and a background banner */
const ORGANIZATION_TABS: { key: TabType; label: string }[] = [
  { key: "poster", label: "Logo" },
  { key: "background", label: "Background" },
];

const ASPECT_CLASSES: Record<TabType, string> = {
  poster: "aspect-[2/3]",
  background: "aspect-video",
  gallery: "aspect-square",
};

function thumbnailUrl(item: MediaItem): string {
  const key = item.thumbnailS3Key ?? item.s3Key;
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

export function MediaManagerDialog({
  open,
  onClose,
  entityType = "work",
  entityId,
  title,
  initialTab = "poster",
  slot = "portrait",
}: MediaManagerDialogProps) {
  const square = slot === "square";
  const tabs =
    entityType === "collection"
      ? COLLECTION_TABS
      : entityType === "organization"
        ? ORGANIZATION_TABS
        : square
          ? SQUARE_TABS
          : TABS;
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [settingActive, setSettingActive] = useState<string | null>(null);
  const [deletingSingle, setDeletingSingle] = useState<string | null>(null);
  // A delete waits for the confirm dialog: one image, or the selection
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "single"; id: string; name: string } | { kind: "bulk"; count: number } | null
  >(null);

  // URL paste state
  const [showUrlSection, setShowUrlSection] = useState(false);
  const [url, setUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);

  const [adjustmentVersion, setAdjustmentVersion] = useState(0);
  // An organization's logo tab makes logo cards; a saved card can be adjusted
  const logoCards = entityType === "organization" && activeTab === "poster";
  const [adjusting, setAdjusting] = useState<LogoSource | null>(null);
  // Gallery images have no active one; clicking an image opens its details.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const isGallery = activeTab === "gallery";
  // What the open tab's images are called: "poster", "logo", or "image" in a square frame
  const noun =
    activeTab !== "poster"
      ? activeTab
      : entityType === "organization"
        ? "logo"
        : square
          ? "image"
          : activeTab;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMediaByType(entityId, activeTab, entityType);
      setItems(data as MediaItem[]);
    } catch {
      toast.error("Failed to load media");
    } finally {
      setLoading(false);
    }
  }, [entityId, activeTab, entityType]);

  // Fetch on open and tab change
  useEffect(() => {
    if (open) {
      fetchItems();
      setSelected(new Set());
      setShowUrlSection(false);
      setUrl("");
    }
  }, [open, fetchItems]);

  // Reset tab on open with initialTab
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  function handleClose() {
    setSelected(new Set());
    setShowUrlSection(false);
    setUrl("");
    setUrlLoading(false);
    onClose();
  }

  function handleTabChange(tab: TabType) {
    setActiveTab(tab);
    setDetailsId(null);
    setSelected(new Set());
    setShowUrlSection(false);
    setUrl("");
  }

  async function handleSetActive(id: string) {
    if (isGallery) return;
    setSettingActive(id);
    try {
      await setActiveMedia(id);
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
      toast.success(`Active ${noun} updated`);
    } catch {
      toast.error(`Failed to set active ${noun}`);
    } finally {
      setSettingActive(null);
    }
  }

  async function handleDeleteSingle(id: string) {
    setDeletingSingle(id);
    try {
      await deleteMedia(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
      toast.success("Media deleted");
    } catch {
      toast.error("Failed to delete media");
    } finally {
      setDeletingSingle(null);
    }
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    try {
      await bulkDeleteMedia(Array.from(selected));
      setSelected(new Set());
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
      toast.success(`Deleted ${selected.size} item${selected.size > 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to delete selected media");
    } finally {
      setDeleting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "single") await handleDeleteSingle(pendingDelete.id);
    else await handleBulkDelete();
    setPendingDelete(null);
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleUploadComplete() {
    fetchItems();
    router.refresh();
  }

  async function handleUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setUrlLoading(true);
    try {
      const res = await fetch("/api/media/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          mediaType: activeTab,
          imageUrl: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to add ${noun} from URL`);
      }

      setUrl("");
      toast.success(`${noun.charAt(0).toUpperCase() + noun.slice(1)} added`);
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to add ${noun} from URL`,
      );
    } finally {
      setUrlLoading(false);
    }
  }

  const activeItem = !isGallery ? items.find((i) => i.isActive) : null;
  const detailsItem = isGallery ? items.find((i) => i.id === detailsId) : null;

  const manager = (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Manage media"
      description={title}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-glass-border pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-bg-tertiary text-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <>
            {/* Active item section with crop editor (poster/background only) */}
            {!isGallery && (
              <div className="space-y-3">
                {activeItem ? (
                  <>
                    <ImageAdjustmentEditor
                      key={`${activeItem.id}-${adjustmentVersion}`}
                      source={`/api/s3/read?key=${encodeURIComponent(activeItem.s3Key)}`}
                      onSaved={() => { void fetchItems(); router.refresh(); triggerActivityRefresh(); }}
                    />
                    <ImageDetailsEditor
                      key={activeItem.id}
                      mediaId={activeItem.id}
                      details={activeItem}
                      onSaved={() => { void fetchItems(); router.refresh(); }}
                    />
                  </>
                ) : (
                  <p className="py-3 text-sm text-fg-secondary">
                    No active {noun}
                  </p>
                )}
              </div>
            )}

            {/* Grid of all items */}
            {items.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-fg-secondary">
                  {isGallery ? "Gallery images" : `All ${noun}s`}
                  <span className="ml-1 font-mono text-fg-secondary">
                    ({items.length})
                  </span>
                </p>
                <div
                  className={`grid gap-2 ${
                    isGallery
                      ? "grid-cols-3 sm:grid-cols-4"
                      : activeTab === "poster"
                        ? "grid-cols-3 sm:grid-cols-4"
                        : "grid-cols-2 sm:grid-cols-3"
                  }`}
                >
                  {items.map((item) => {
                    const isSelected = selected.has(item.id);
                    const isSettingThisActive = settingActive === item.id;
                    const isDeletingThis = deletingSingle === item.id;

                    return (
                      <div key={item.id} className="group relative">
                        <ImageAdjustButton source={`/api/s3/read?key=${encodeURIComponent(item.s3Key)}`} className="absolute bottom-7 left-1.5 z-10" onSaved={() => { setAdjustmentVersion((v) => v + 1); void fetchItems(); router.refresh(); }} />
                        {/* Selection checkbox */}
                        <button
                          aria-label={isSelected ? "Deselect image" : "Select image"}
                          data-tooltip={isSelected ? "Deselect image" : "Select image"}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelection(item.id);
                          }}
                          className={`absolute left-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-sm border transition-all ${
                            isSelected
                              ? "border-accent-rose bg-accent-rose"
                              : "border-glass-border bg-bg-primary/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                          }`}
                        >
                          {isSelected && (
                            <Check className="h-3 w-3 text-fg-primary" strokeWidth={2} />
                          )}
                        </button>

                        {/* Delete button */}
                        <button
                          aria-label="Delete image"
                          data-tooltip="Delete image"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete({
                              kind: "single",
                              id: item.id,
                              name: item.caption || item.originalFilename || "Image",
                            });
                          }}
                          disabled={isDeletingThis}
                          className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-sm bg-bg-primary/80 text-fg-muted opacity-0 transition-all hover:bg-accent-red/20 hover:text-accent-red group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                        >
                          {isDeletingThis ? (
                            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
                          ) : (
                            <X className="h-3 w-3" strokeWidth={1.5} />
                          )}
                        </button>

                        {/* Thumbnail */}
                        <button
                          type="button"
                          onClick={() => {
                            if (isGallery) setDetailsId(item.id === detailsId ? null : item.id);
                            else handleSetActive(item.id);
                          }}
                          disabled={isSettingThisActive || (item.isActive && !isGallery)}
                          aria-pressed={isGallery ? item.id === detailsId : undefined}
                          aria-label={isGallery ? `Image details: ${item.altText || item.originalFilename || "gallery image"}` : undefined}
                          className={`relative w-full overflow-hidden rounded-sm border transition-all ${square && activeTab === "poster" ? "aspect-square bg-bg-tertiary" : ASPECT_CLASSES[activeTab]} ${
                            (item.isActive && !isGallery) || (isGallery && item.id === detailsId)
                              ? "ring-2 ring-accent-rose border-accent-rose/30"
                              : "border-glass-border hover:border-fg-muted/30"
                          } ${!isGallery && !item.isActive ? "cursor-pointer" : ""}`}
                        >
                          <img
                            src={thumbnailUrl(item)}
                            alt={item.altText || item.caption || item.originalFilename || "Media"}
                            className={`h-full w-full ${square && activeTab === "poster" ? "object-contain" : "object-cover"}`}
                          />
                          {/* Hover overlay for set active */}
                          {!isGallery && !item.isActive && (
                            <div className="absolute inset-0 flex items-center justify-center bg-overlay opacity-0 transition-opacity group-hover:opacity-100 in-focus-visible:opacity-100">
                              {isSettingThisActive ? (
                                <Spinner className="text-fg-primary" />
                              ) : (
                                <span className="text-micro font-medium text-fg-primary">
                                  Set active
                                </span>
                              )}
                            </div>
                          )}
                          {/* Active indicator overlay */}
                          {item.isActive && !isGallery && (
                            <div className="absolute bottom-1 right-1">
                              <Badge variant="rose">Active</Badge>
                            </div>
                          )}
                        </button>

                        {/* Dimensions */}
                        <div className="mt-1 flex flex-col">
                          {item.width && item.height && (
                            <span className="font-mono text-micro text-fg-secondary">
                              {item.width}x{item.height}
                            </span>
                          )}
                          {logoCards && isLogoCard(item.processingParams) && (
                            <button
                              type="button"
                              onClick={() =>
                                setAdjusting({
                                  mediaId: item.id,
                                  options: parseLogoCardOptions(
                                    (item.processingParams as { logoCard?: unknown }).logoCard,
                                  ),
                                })
                              }
                              className="self-start text-xs text-fg-secondary transition-colors hover:text-fg-primary"
                            >
                              Adjust
                            </button>
                          )}
                          {isGallery && item.caption && (
                            <span className="truncate text-micro text-fg-secondary">
                              {item.caption}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {detailsItem && (
              <ImageDetailsEditor
                key={detailsItem.id}
                mediaId={detailsItem.id}
                details={detailsItem}
                onSaved={() => { void fetchItems(); router.refresh(); }}
              />
            )}

            {items.length === 0 && !loading && (
              <p className="py-4 text-center text-sm text-fg-secondary">
                {noun === "image" ? "No image uploaded yet" : `No ${noun} images uploaded yet`}
              </p>
            )}

            {/* Upload section: an organization's logo becomes its card (SLN-441) */}
            {logoCards ? (
              <div className="border-t border-glass-border pt-4">
                <LogoCardUpload
                  organizationId={entityId}
                  source={adjusting}
                  onSaved={() => {
                    setAdjusting(null);
                    handleUploadComplete();
                  }}
                />
              </div>
            ) : (
            <div className="border-t border-glass-border pt-4">
              <UploadZone
                entityType={entityType}
                entityId={entityId}
                mediaType={activeTab}
                noun={noun}
                multiple={isGallery}
                onUploadComplete={handleUploadComplete}
              />

              <button
                type="button"
                onClick={() => setShowUrlSection((v) => !v)}
                className="mt-3 flex items-center gap-1 text-xs text-fg-secondary cursor-pointer hover:text-fg-primary transition-colors"
              >
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${showUrlSection ? "rotate-90" : ""}`}
                  strokeWidth={1.5}
                />
                Or paste image URL
              </button>

              {showUrlSection && (
                <form
                  onSubmit={handleUrlSubmit}
                  className="mt-2 flex items-center gap-2"
                >
                  <Input
                    placeholder="Paste image URL..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={urlLoading}
                    className="flex-1"
                  />
                  <button
                    type="submit"
                    disabled={urlLoading || !url.trim()}
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-sm bg-accent-rose px-4 text-sm font-medium text-fg-primary transition-colors hover:bg-accent-rose/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {urlLoading && (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin"
                        strokeWidth={1.5}
                      />
                    )}
                    Add
                  </button>
                </form>
              )}
            </div>
            )}

            {/* Bulk actions bar */}
            {selected.size > 0 && (
              <div className="flex items-center justify-between border-t border-glass-border pt-3">
                <span className="text-xs text-fg-secondary">
                  {selected.size} selected
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() =>
                    setPendingDelete({ kind: "bulk", count: selected.size })
                  }
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      strokeWidth={1.5}
                    />
                  ) : (
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  )}
                  Delete selected
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );

  const manyPending = pendingDelete?.kind === "bulk" && pendingDelete.count > 1;

  // The confirm is a sibling, not a child: React passes a child dialog's
  // cancel (Escape) up to the parent, which would close both.
  return (
    <>
      {manager}
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        title={manyPending ? "Delete images" : "Delete image"}
        description={
          manyPending
            ? "The images and their files are deleted. This cannot be undone."
            : "The image and its files are deleted. This cannot be undone."
        }
        itemName={
          pendingDelete?.kind === "bulk"
            ? `${pendingDelete.count} image${pendingDelete.count === 1 ? "" : "s"}`
            : (pendingDelete?.name ?? "")
        }
      />
    </>
  );
}
