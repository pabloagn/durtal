"use client";

import { useRef, useState } from "react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { useRouter } from "next/navigation";
import { ChevronRight, ImageIcon } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadZone, type UploadTarget } from "@/components/media/upload-zone";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { EditionImageBox } from "@/components/books/edition-cover";
import { editionImage, type PosterImage } from "@/lib/utils/edition-image";
import { mediaResponseError } from "@/lib/utils/media-upload";
import { isOwnEditionCoverKey } from "@/lib/s3/keys";
import { mediaUrl } from "@/lib/s3/media-url";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { showBookCover, restoreOwnCover } from "@/lib/actions/edition-cover";
import type { OwnCover } from "@/lib/catalogue/edition-cover";

interface EditionCoverDialogProps {
  edition: OwnCover & { id: string; title: string };
  /** The book's active poster: what the edition shows without its own cover */
  poster?: PosterImage | null;
}

/**
 * The edition's cover in one place (SLN-638): choose or drop an image, use
 * the book's cover, adjust the edition's own cover, or put back the own
 * cover it used before.
 */
export function EditionCoverDialog({ edition, poster }: EditionCoverDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The own cover replaced by the book's, while it can still be put back
  const [replaced, setReplaced] = useState<OwnCover | null>(null);
  // Asked before an own cover that cannot be put back is replaced
  const [confirming, setConfirming] = useState(false);
  // An image address typed in, as the book's media dialog takes one
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  // The button that takes the place of the one just pressed gets the focus,
  // once the refreshed edition shows it, so focus never falls to the page
  const focusNext = useRef<"put-back" | "use-book" | null>(null);
  const takeFocus = (name: "put-back" | "use-book") => (el: HTMLButtonElement | null) => {
    if (el && focusNext.current === name) {
      focusNext.current = null;
      el.focus();
    }
  };

  const ownKey = edition.thumbnailS3Key ?? edition.coverS3Key;
  const image = editionImage(edition, poster);
  const bookCover = poster ? editionImage({ coverS3Key: null, thumbnailS3Key: null }, poster) : null;
  const restorable =
    !!ownKey &&
    [edition.coverS3Key, edition.thumbnailS3Key].every(
      (key) => !key || isOwnEditionCoverKey(edition.id, key),
    );

  function changed() {
    router.refresh();
    triggerActivityRefresh();
  }

  async function send(init: RequestInit) {
    const response = await fetch(`/api/editions/${edition.id}/cover`, { method: "POST", ...init });
    if (!response.ok) throw await mediaResponseError(response);
    setReplaced(null);
    toast.success("Cover saved");
    changed();
  }

  const target: UploadTarget = {
    file: (file) => {
      const body = new FormData();
      body.append("file", file);
      return send({ body });
    },
    url: (imageUrl) =>
      send({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      }),
  };

  async function addFromUrl() {
    const imageUrl = url.trim();
    if (!imageUrl || urlBusy) return;
    setUrlBusy(true);
    try {
      await target.url(imageUrl);
      setUrl("");
    } catch (error) {
      toast.error((error as Error).message || "The cover could not be saved.");
    } finally {
      setUrlBusy(false);
    }
  }

  async function putBack(cover: OwnCover) {
    setBusy(true);
    try {
      await restoreOwnCover(edition.id, cover);
      setReplaced(null);
      focusNext.current = "use-book";
      toast.success("The edition's own cover is back");
      changed();
    } catch (error) {
      toast.error((error as Error).message || "The cover could not be put back.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseBookCover() {
    setConfirming(false);
    setBusy(true);
    try {
      const { previous, restorable: canRestore } = await showBookCover(edition.id);
      const undo = previous && canRestore ? previous : null;
      setReplaced(undo);
      if (undo) focusNext.current = "put-back";
      // No Undo on the toast: the modal dialog makes it inert. "Put back this
      // edition's cover" takes this button's place in the dialog instead.
      toast.success("Now using the book's cover");
      changed();
    } catch (error) {
      toast.error((error as Error).message || "The cover could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        data-tooltip="Choose this edition's cover"
      >
        <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
        Cover
      </Button>

      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setConfirming(false);
        }}
        title="Edition cover"
        description={edition.title}
        className="max-w-lg"
        expandable={false}
        done
        dirty={url.trim() !== ""}
        onSave={() => void addFromUrl()}
      >
        <div className="space-y-4" aria-busy={busy}>
          <div className="flex gap-4">
            <EditionImageBox image={image} title={edition.title} />
            {ownKey && bookCover && (
              <figure className="shrink-0 space-y-1">
                <EditionImageBox image={bookCover} title={edition.title} />
                <figcaption className="text-xs text-fg-secondary">The book&apos;s</figcaption>
              </figure>
            )}
            <div className="min-w-0 space-y-1 text-xs">
              <p className="font-medium text-fg-primary">
                {ownKey
                  ? "This edition's own cover"
                  : image
                    ? "The book's cover"
                    : "No cover yet"}
              </p>
              <p className="text-fg-secondary">
                {ownKey
                  ? "Only this edition shows it."
                  : image
                    ? "Follows the book's cover when it changes."
                    : "Choose an image, or give the book a cover."}
              </p>
            </div>
          </div>

          <div>
            <UploadZone send={target} noun="cover" onUploadComplete={() => setConfirming(false)} />
            <button
              type="button"
              onClick={() => setShowUrl((v) => !v)}
              aria-expanded={showUrl}
              className="mt-3 flex items-center gap-1 text-xs text-fg-secondary cursor-pointer hover:text-fg-primary transition-colors pointer-coarse:min-h-11"
            >
              {/* On the label's cap height, not its line box */}
              <CapAligned height={12}>
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${showUrl ? "rotate-90" : ""}`}
                  strokeWidth={1.5}
                />
              </CapAligned>
              Or paste image URL
            </button>
            {showUrl && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void addFromUrl();
                }}
                className="mt-2 flex items-center gap-2"
              >
                <Input
                  type="url"
                  aria-label="Image URL"
                  placeholder="Paste image URL..."
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={urlBusy}
                  className="flex-1"
                />
                <Button type="submit" size="sm" variant="secondary" busy={urlBusy} disabled={!url.trim()} data-shortcut="save">
                  Add
                </Button>
              </form>
            )}
          </div>

          {confirming ? (
            <div role="alert" className="space-y-3 rounded-sm bg-bg-tertiary p-3 text-xs">
              <p className="text-fg-primary">
                This edition&apos;s own cover cannot be put back afterwards.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={chooseBookCover} disabled={busy}>
                  Use the book&apos;s cover
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep this cover
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {ownKey && (
                <Button
                  ref={takeFocus("use-book")}
                  size="sm"
                  variant="secondary"
                  disabled={busy || !bookCover}
                  onClick={() => (restorable ? chooseBookCover() : setConfirming(true))}
                >
                  Use the book&apos;s cover
                </Button>
              )}
              {!ownKey && replaced && (
                <Button
                  ref={takeFocus("put-back")}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => putBack(replaced)}
                >
                  Put back this edition&apos;s cover
                </Button>
              )}
              {ownKey && (
                <ImageAdjustButton
                  source={mediaUrl(edition.coverS3Key ?? ownKey)}
                  label="Adjust edition cover"
                  appearance="ghost"
                  onSaved={changed}
                />
              )}
              {ownKey && !bookCover && (
                <span className="text-xs text-fg-secondary">The book has no cover to use.</span>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
