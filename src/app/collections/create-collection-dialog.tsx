"use client";

import { useState, useCallback, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Plus,
  Search,
  X,
  Upload,
  ImageIcon,
  Loader2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createCollection,
  searchEditionsForPicker,
  bulkAddEditionsToCollection,
} from "@/lib/actions/collections";

// ── Types ────────────────────────────────────────────────────────────────────

interface EditionResult {
  editionId: string;
  editionTitle: string;
  thumbnailS3Key: string | null;
  publicationYear: number | null;
  publisher: string | null;
  workId: string;
  workTitle: string;
  authorName: string | null;
}

interface ImageUploadState {
  file: File | null;
  preview: string | null;
  uploading: boolean;
}

// ── Image upload helper ──────────────────────────────────────────────────────

function ImageUploadField({
  label,
  description,
  aspect,
  value,
  onChange,
}: {
  label: string;
  description: string;
  aspect: string;
  value: ImageUploadState;
  onChange: (state: ImageUploadState) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    const preview = URL.createObjectURL(file);
    onChange({ file, preview, uploading: false });
  }

  function handleClear() {
    if (value.preview) URL.revokeObjectURL(value.preview);
    onChange({ file: null, preview: null, uploading: false });
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-fg-secondary">{label}</p>
      <p className="mb-2 text-micro text-fg-muted">{description}</p>

      {value.preview ? (
        <div className="group relative">
          <div
            className={`relative overflow-hidden rounded-sm border border-glass-border bg-bg-primary ${aspect}`}
          >
            <Image
              src={value.preview}
              alt={label}
              fill
              className="object-cover"
            unoptimized
            />
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-2 rounded-sm bg-bg-primary/80 p-1 text-fg-muted opacity-0 transition-opacity hover:text-fg-primary group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith("image/")) handleFile(file);
          }}
          className={`flex w-full flex-col items-center justify-center rounded-sm border-2 border-dashed border-glass-border bg-bg-primary/50 transition-colors hover:border-fg-muted/30 ${aspect}`}
        >
          <Upload className="mb-1.5 h-5 w-5 text-fg-muted" strokeWidth={1.5} />
          <span className="text-micro text-fg-muted">
            Drop image or click to browse
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}

// ── Upload to S3 via presign pipeline ────────────────────────────────────────

async function uploadCollectionImage(
  collectionId: string,
  mediaType: "poster" | "background",
  file: File,
): Promise<{ s3Key: string; thumbnailS3Key?: string }> {
  // 1. Presign
  const presignRes = await fetch("/api/media/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "presign",
      entityType: "collection",
      entityId: collectionId,
      filename: file.name,
      contentType: file.type,
    }),
  });
  const { url, bronzeKey, fileId } = await presignRes.json();

  // 2. Upload to S3
  await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });

  // 3. Process
  const processRes = await fetch("/api/media/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "process",
      entityType: "collection",
      entityId: collectionId,
      mediaType,
      fileId,
      bronzeKey,
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });

  return processRes.json();
}

// ── Main dialog ──────────────────────────────────────────────────────────────

export function CreateCollectionDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [poster, setPoster] = useState<ImageUploadState>({
    file: null,
    preview: null,
    uploading: false,
  });
  const [background, setBackground] = useState<ImageUploadState>({
    file: null,
    preview: null,
    uploading: false,
  });

  // Edition picker state
  const [editionSearch, setEditionSearch] = useState("");
  const [searchResults, setSearchResults] = useState<EditionResult[]>([]);
  const [selectedEditions, setSelectedEditions] = useState<EditionResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetForm() {
    setName("");
    setDescription("");
    if (poster.preview) URL.revokeObjectURL(poster.preview);
    if (background.preview) URL.revokeObjectURL(background.preview);
    setPoster({ file: null, preview: null, uploading: false });
    setBackground({ file: null, preview: null, uploading: false });
    setEditionSearch("");
    setSearchResults([]);
    setSelectedEditions([]);
  }

  function openDialog() {
    resetForm();
    setOpen(true);
  }

  const handleSearch = useCallback((query: string) => {
    setEditionSearch(query);

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchEditionsForPicker(query);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  function addEdition(edition: EditionResult) {
    if (selectedEditions.some((e) => e.editionId === edition.editionId)) return;
    setSelectedEditions((prev) => [...prev, edition]);
    setEditionSearch("");
    setSearchResults([]);
  }

  function removeEdition(editionId: string) {
    setSelectedEditions((prev) =>
      prev.filter((e) => e.editionId !== editionId),
    );
  }

  function getImageUrl(s3Key: string) {
    return `/api/s3/read?key=${encodeURIComponent(s3Key)}`;
  }

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        // 1. Create the collection
        const collection = await createCollection({
          name: name.trim(),
          description: description.trim() || null,
        });

        // 2. Upload images in parallel (if any)
        const uploads: Promise<void>[] = [];

        if (poster.file) {
          uploads.push(
            uploadCollectionImage(collection.id, "poster", poster.file).then(
              () => {},
            ),
          );
        }

        if (background.file) {
          uploads.push(
            uploadCollectionImage(
              collection.id,
              "background",
              background.file,
            ).then(() => {}),
          );
        }

        await Promise.all(uploads);

        // 3. Add editions to collection
        if (selectedEditions.length > 0) {
          await bulkAddEditionsToCollection(
            collection.id,
            selectedEditions.map((e) => e.editionId),
          );
        }

        toast.success("Collection created");
        setOpen(false);
        resetForm();
        router.refresh();
      } catch {
        toast.error("Failed to create collection");
      }
    });
  }

  const alreadySelected = new Set(selectedEditions.map((e) => e.editionId));

  return (
    <>
      <Button variant="primary" size="md" onClick={openDialog}>
        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        New collection
      </Button>

      <Dialog
        open={open}
        onClose={() => !isPending && setOpen(false)}
        title="Create collection"
        description="Organize editions into a curated group"
        className="max-w-2xl"
      >
        <div className="max-h-[72vh] space-y-6 overflow-y-auto pr-1">
          {/* Section: Details */}
          <section>
            <h3 className="mb-3 font-serif text-base text-fg-secondary">
              Details
            </h3>
            <div className="space-y-3">
              <Input
                id="collection-name"
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Gothic Fiction, Summer Reading 2025"
                autoFocus
              />
              <Textarea
                id="collection-description"
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="A brief description of this collection..."
              />
            </div>
          </section>

          {/* Section: Artwork */}
          <section>
            <h3 className="mb-3 font-serif text-base text-fg-secondary">
              Artwork
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <ImageUploadField
                label="Poster"
                description="Vertical cover art (2:3 ratio)"
                aspect="aspect-[2/3]"
                value={poster}
                onChange={setPoster}
              />
              <ImageUploadField
                label="Background"
                description="Wide hero banner (16:9 ratio)"
                aspect="aspect-video"
                value={background}
                onChange={setBackground}
              />
            </div>
          </section>

          {/* Section: Editions */}
          <section>
            <h3 className="mb-3 font-serif text-base text-fg-secondary">
              Editions
            </h3>

            {/* Search box */}
            <div className="relative mb-3">
              <Search
                className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
                strokeWidth={1.5}
              />
              <input
                type="text"
                value={editionSearch}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by title, work, or author..."
                className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
              />
              {isSearching && (
                <Loader2
                  className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-fg-muted"
                  strokeWidth={1.5}
                />
              )}
            </div>

            {/* Search results dropdown */}
            {searchResults.length > 0 && (
              <div className="mb-3 max-h-48 overflow-y-auto rounded-sm border border-glass-border bg-bg-secondary">
                {searchResults.map((edition) => {
                  const isSelected = alreadySelected.has(edition.editionId);
                  return (
                    <button
                      key={edition.editionId}
                      type="button"
                      onClick={() => !isSelected && addEdition(edition)}
                      disabled={isSelected}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-bg-tertiary disabled:opacity-40"
                    >
                      <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-bg-primary">
                        {edition.thumbnailS3Key ? (
                          <Image
                            src={getImageUrl(edition.thumbnailS3Key)}
                            alt=""
                            fill
                            className="object-cover"
                            sizes="28px"
                          unoptimized
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageIcon
                              className="h-3 w-3 text-fg-muted/40"
                              strokeWidth={1.5}
                            />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-fg-primary">
                          {edition.editionTitle}
                        </p>
                        <p className="truncate text-micro text-fg-muted">
                          {edition.authorName ?? "Unknown"}
                          {edition.publicationYear
                            ? ` \u00b7 ${edition.publicationYear}`
                            : ""}
                          {edition.publisher
                            ? ` \u00b7 ${edition.publisher}`
                            : ""}
                        </p>
                      </div>
                      {isSelected && (
                        <span className="text-micro text-fg-muted">Added</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Selected editions */}
            {selectedEditions.length > 0 ? (
              <div className="space-y-1.5">
                {selectedEditions.map((edition, idx) => (
                  <div
                    key={edition.editionId}
                    className="flex items-center gap-3 rounded-sm border border-glass-border bg-bg-primary px-3 py-2"
                  >
                    <span className="w-5 text-center font-mono text-micro text-fg-muted">
                      {idx + 1}
                    </span>
                    <div className="relative h-8 w-5 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                      {edition.thumbnailS3Key ? (
                        <Image
                          src={getImageUrl(edition.thumbnailS3Key)}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="20px"
                        unoptimized
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <span className="font-serif text-nano text-fg-muted/40">
                            {edition.editionTitle[0]}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg-primary">
                        {edition.editionTitle}
                      </p>
                      <p className="truncate text-micro text-fg-muted">
                        {edition.authorName ?? "Unknown"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeEdition(edition.editionId)}
                      className="rounded-sm p-1 text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-glass-border py-6">
                <Layers
                  className="mb-1.5 h-5 w-5 text-fg-muted"
                  strokeWidth={1.5}
                />
                <p className="text-xs text-fg-muted">
                  Search above to add editions
                </p>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-glass-border pt-4">
          <p className="text-micro text-fg-muted">
            {selectedEditions.length}{" "}
            {selectedEditions.length === 1 ? "edition" : "editions"} selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={isPending || !name.trim()}
            >
              {isPending ? (
                <>
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.5}
                  />
                  Creating
                </>
              ) : (
                "Create collection"
              )}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
