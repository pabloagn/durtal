"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, X, Check, Trash2, SlidersHorizontal } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UploadZone } from "@/components/media/upload-zone";
import { MonochromeControls } from "@/components/media/monochrome-controls";
import {
  getMediaForAuthor,
  setActiveMedia,
  deleteMedia,
  bulkDeleteMedia,
  updateMediaCrop,
} from "@/lib/actions/media";
import { MediaCropEditor } from "@/components/books/media-crop-editor";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import {
  DEFAULT_MONOCHROME_PARAMS,
  parseProcessingParams,
  type MonochromeParams,
} from "@/lib/validations/media";
import { toast } from "sonner";

type TabType = "poster" | "background" | "gallery";

interface MediaItem {
  id: string;
  type: string;
  s3Key: string;
  thumbnailS3Key: string | null;
  originalS3Key: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  isActive: boolean;
  sortOrder: number;
  caption: string | null;
  cropX: number;
  cropY: number;
  cropZoom: number;
  processingParams: unknown;
  createdAt: Date;
}

interface AuthorMediaManagerDialogProps {
  open: boolean;
  onClose: () => void;
  authorId: string;
  authorName: string;
  initialTab?: TabType;
}

const TABS: { key: TabType; label: string }[] = [
  { key: "poster", label: "Poster" },
  { key: "background", label: "Background" },
  { key: "gallery", label: "Gallery" },
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

export function AuthorMediaManagerDialog({
  open,
  onClose,
  authorId,
  authorName,
  initialTab = "poster",
}: AuthorMediaManagerDialogProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [settingActive, setSettingActive] = useState<string | null>(null);
  const [deletingSingle, setDeletingSingle] = useState<string | null>(null);
  const [savingCrop, setSavingCrop] = useState(false);
  const [tuningId, setTuningId] = useState<string | null>(null);

  // URL paste state
  const [showUrlSection, setShowUrlSection] = useState(false);
  const [url, setUrl] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);

  const isGallery = activeTab === "gallery";

  const filteredItems = items.filter((i) => i.type === activeTab);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMediaForAuthor(authorId);
      setItems(data as MediaItem[]);
    } catch {
      toast.error("Failed to load media");
    } finally {
      setLoading(false);
    }
  }, [authorId]);

  useEffect(() => {
    if (open) {
      fetchItems();
      setSelected(new Set());
      setShowUrlSection(false);
      setUrl("");
      setTuningId(null);
    }
  }, [open, fetchItems]);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  function handleClose() {
    setSelected(new Set());
    setShowUrlSection(false);
    setUrl("");
    setUrlLoading(false);
    setTuningId(null);
    onClose();
  }

  function handleTabChange(tab: TabType) {
    setActiveTab(tab);
    setSelected(new Set());
    setShowUrlSection(false);
    setUrl("");
    setTuningId(null);
  }

  async function handleSetActive(id: string) {
    if (isGallery) return;
    setSettingActive(id);
    try {
      await setActiveMedia(id);
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
      toast.success(`Active ${activeTab} updated`);
    } catch {
      toast.error(`Failed to set active ${activeTab}`);
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
      if (tuningId === id) setTuningId(null);
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
      setTuningId(null);
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

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
          entityType: "author",
          entityId: authorId,
          mediaType: activeTab,
          imageUrl: trimmed,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to add ${activeTab} from URL`);
      }

      setUrl("");
      toast.success(`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} added`);
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to add ${activeTab} from URL`,
      );
    } finally {
      setUrlLoading(false);
    }
  }

  async function handleReprocess(params: MonochromeParams) {
    if (!tuningId) return;
    try {
      const res = await fetch("/api/media/reprocess-author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: tuningId, processingParams: params }),
      });
      if (!res.ok) throw new Error("Reprocessing failed");
      toast.success("Image reprocessed");
      await fetchItems();
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Failed to reprocess image");
    }
  }

  const activeItem = !isGallery ? filteredItems.find((i) => i.isActive) : null;
  const tuningItem = tuningId ? filteredItems.find((i) => i.id === tuningId) : null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Manage author media"
      description={authorName}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-glass-border pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-bg-tertiary text-fg-primary"
                  : "text-fg-muted hover:text-fg-secondary"
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
            {/* Active item with crop editor (poster/background only) */}
            {!isGallery && (
              <div className="space-y-3">
                {activeItem ? (
                  <MediaCropEditor
                    imageUrl={`/api/s3/read?key=${encodeURIComponent(activeItem.s3Key)}`}
                    aspect={activeTab as "poster" | "background"}
                    initial={{
                      cropX: activeItem.cropX,
                      cropY: activeItem.cropY,
                      cropZoom: activeItem.cropZoom,
                    }}
                    saving={savingCrop}
                    onSave={async (values) => {
                      setSavingCrop(true);
                      try {
                        await updateMediaCrop(activeItem.id, values);
                        await fetchItems();
                        router.refresh();
      triggerActivityRefresh();
                        toast.success("Position saved");
                      } catch {
                        toast.error("Failed to save position");
                      } finally {
                        setSavingCrop(false);
                      }
                    }}
                  />
                ) : (
                  <p className="py-3 text-sm text-fg-muted">
                    No active {activeTab}
                  </p>
                )}
              </div>
            )}

            {/* Grid of all items */}
            {filteredItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-fg-secondary">
                  {isGallery ? "Gallery images" : `All ${activeTab}s`}
                  <span className="ml-1 font-mono text-fg-muted">
                    ({filteredItems.length})
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
                  {filteredItems.map((item) => {
                    const isSelected = selected.has(item.id);
                    const isSettingThisActive = settingActive === item.id;
                    const isDeletingThis = deletingSingle === item.id;
                    const isTuning = tuningId === item.id;

                    return (
                      <div key={item.id} className="group relative">
                        {/* Selection checkbox */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelection(item.id);
                          }}
                          className={`absolute left-1.5 top-1.5 z-10 flex h-4 w-4 items-center justify-center rounded-sm border transition-all ${
                            isSelected
                              ? "border-accent-rose bg-accent-rose"
                              : "border-glass-border bg-bg-primary/70 opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          {isSelected && (
                            <Check className="h-3 w-3 text-white" strokeWidth={2} />
                          )}
                        </button>

                        {/* Tune button (only for items with originals) */}
                        {item.originalS3Key && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTuningId(isTuning ? null : item.id);
                            }}
                            className={`absolute left-7 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-sm transition-all ${
                              isTuning
                                ? "bg-accent-rose text-white"
                                : "bg-bg-primary/80 text-fg-muted opacity-0 hover:text-accent-rose group-hover:opacity-100"
                            }`}
                          >
                            <SlidersHorizontal className="h-3 w-3" strokeWidth={1.5} />
                          </button>
                        )}

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSingle(item.id);
                          }}
                          disabled={isDeletingThis}
                          className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-sm bg-bg-primary/80 text-fg-muted opacity-0 transition-all hover:bg-accent-red/20 hover:text-accent-red group-hover:opacity-100"
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
                            if (!isGallery) handleSetActive(item.id);
                          }}
                          disabled={isSettingThisActive || (item.isActive && !isGallery)}
                          className={`relative w-full overflow-hidden rounded-sm border transition-all ${ASPECT_CLASSES[activeTab]} ${
                            item.isActive && !isGallery
                              ? "ring-2 ring-accent-rose border-accent-rose/30"
                              : "border-glass-border hover:border-fg-muted/30"
                          } ${!isGallery && !item.isActive ? "cursor-pointer" : ""}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbnailUrl(item)}
                            alt={item.caption || item.originalFilename || "Media"}
                            className="h-full w-full object-cover"
                          />
                          {!isGallery && !item.isActive && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                              {isSettingThisActive ? (
                                <Spinner className="text-white" />
                              ) : (
                                <span className="text-micro font-medium text-white">
                                  Set active
                                </span>
                              )}
                            </div>
                          )}
                          {item.isActive && !isGallery && (
                            <div className="absolute bottom-1 right-1">
                              <Badge variant="rose">Active</Badge>
                            </div>
                          )}
                        </button>

                        {/* Dimensions */}
                        <div className="mt-1 flex flex-col">
                          {item.width && item.height && (
                            <span className="font-mono text-micro text-fg-muted">
                              {item.width}x{item.height}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Inline monochrome controls for the item being tuned */}
            {tuningItem && tuningItem.originalS3Key && (
              <MonochromeControls
                mediaId={tuningItem.id}
                currentParams={
                  parseProcessingParams(tuningItem.processingParams) ??
                  DEFAULT_MONOCHROME_PARAMS
                }
                onApply={handleReprocess}
              />
            )}

            {filteredItems.length === 0 && !loading && (
              <p className="py-4 text-center text-sm text-fg-muted">
                No {activeTab} images uploaded yet
              </p>
            )}

            {/* Upload section */}
            <div className="border-t border-glass-border pt-4">
              <UploadZone
                entityType="author"
                entityId={authorId}
                mediaType={activeTab}
                multiple={isGallery}
                onUploadComplete={handleUploadComplete}
                processingParams={DEFAULT_MONOCHROME_PARAMS}
              />

              <button
                type="button"
                onClick={() => setShowUrlSection((v) => !v)}
                className="mt-3 flex items-center gap-1 text-xs text-fg-muted cursor-pointer hover:text-fg-secondary transition-colors"
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
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-sm bg-accent-rose px-4 text-sm font-medium text-white transition-colors hover:bg-accent-rose/90 disabled:cursor-not-allowed disabled:opacity-40"
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

            {/* Bulk actions bar */}
            {selected.size > 0 && (
              <div className="flex items-center justify-between border-t border-glass-border pt-3">
                <span className="text-xs text-fg-secondary">
                  {selected.size} selected
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleBulkDelete}
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
}
