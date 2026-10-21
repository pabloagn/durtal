"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ImageIcon } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadZone, type UploadTarget } from "@/components/media/upload-zone";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { EditionImageBox } from "@/components/books/edition-cover";
import { editionImage, type PosterImage } from "@/lib/utils/edition-image";
import { mediaResponseError } from "@/lib/utils/media-upload";
import { mediaUrl } from "@/lib/s3/media-url";
import { useFocusThroughBusy } from "@/hooks/use-focus-through-busy";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { getEditionCoverChoices } from "@/lib/actions/edition-cover";
import { showBookCover, restoreSavedCover } from "@/lib/actions/catalogue-client";
import type { OwnCover } from "@/lib/catalogue/edition-cover";

type Choices = Awaited<ReturnType<typeof getEditionCoverChoices>>;
export function EditionCoverDialog({
  edition,
  poster,
}: {
  edition: OwnCover & { id: string; title: string };
  poster?: PosterImage | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const urlField = useRef<HTMLInputElement>(null);
  useFocusThroughBusy(urlBusy, urlField);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const focusHistory = useRef(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    getEditionCoverChoices(edition.id)
      .then((next) => {
        if (active) {
          setChoices(next);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [open, edition.id, attempt]);
  useEffect(() => {
    if (choices && focusHistory.current) {
      focusHistory.current = false;
      historyHeading.current?.focus();
    }
  }, [choices]);

  const shown = choices?.current ?? edition;
  const ownKey = shown.coverS3Key ?? shown.thumbnailS3Key;
  const image = editionImage(shown, poster);
  const bookCover = poster
    ? editionImage({ coverS3Key: null, thumbnailS3Key: null }, poster)
    : null;
  const unavailable = busy || !choices || failed;
  const previous =
    choices?.history.filter(
      (cover) =>
        cover.coverS3Key !== shown.coverS3Key ||
        cover.thumbnailS3Key !== shown.thumbnailS3Key,
    ) ?? [];

  async function changed() {
    router.refresh();
    triggerActivityRefresh();
    try {
      setChoices(await getEditionCoverChoices(edition.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  async function send(init: RequestInit) {
    if (!choices || unavailable)
      throw new Error("Wait for the edition cover editor to load.");
    setBusy(true);
    try {
      const response = await fetch(`/api/editions/${edition.id}/cover`, {
        method: "POST",
        ...init,
      });
      if (!response.ok) throw await mediaResponseError(response);
      toast.success("Cover saved");
      await changed();
    } finally {
      setBusy(false);
    }
  }
  const target: UploadTarget = {
    file: (file) => {
      const body = new FormData();
      body.set("file", file);
      if (choices) body.set("revision", choices.revision);
      return send({ body });
    },
    url: (imageUrl) =>
      send({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, revision: choices?.revision }),
      }),
  };
  async function addFromUrl() {
    if (!url.trim() || urlBusy || unavailable) return;
    setUrlBusy(true);
    try {
      await target.url(url.trim());
      setUrl("");
    } catch (error) {
      toast.error((error as Error).message || "The cover could not be saved.");
    } finally {
      setUrlBusy(false);
    }
  }
  async function useBookCover() {
    if (!choices || unavailable) return;
    setBusy(true);
    try {
      await showBookCover(edition.id, choices.revision);
      focusHistory.current = true;
      toast.success("Now using the book's cover");
      await changed();
    } catch (error) {
      toast.error(
        (error as Error).message || "The cover could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function restore(historyId: string) {
    if (!choices || unavailable) return;
    setBusy(true);
    try {
      await restoreSavedCover(edition.id, historyId, choices.revision);
      focusHistory.current = true;
      toast.success("The edition's earlier cover is back");
      await changed();
    } catch (error) {
      toast.error(
        (error as Error).message || "The cover could not be restored.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!choices || unavailable) return;
    setBusy(true);
    try {
      const next = await getEditionCoverChoices(
        edition.id,
        choices.history.length,
      );
      setChoices(
        next.revision === choices.revision
          ? { ...next, history: [...choices.history, ...next.history] }
          : await getEditionCoverChoices(edition.id),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setChoices(null);
          setFailed(false);
          setOpen(true);
        }}
        data-tooltip="Choose this edition's cover"
      >
        <ImageIcon className="h-4 w-4" strokeWidth={1.5} />
        Cover
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
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
                <figcaption className="text-xs text-fg-secondary">
                  The book&apos;s
                </figcaption>
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
          {failed ? (
            <div role="alert" className="space-y-2 text-sm">
              <p>Could not load the saved covers.</p>
              <Button onClick={() => retry((n) => n + 1)}>Retry</Button>
            </div>
          ) : !choices ? (
            <p role="status" className="text-sm text-fg-secondary">
              Loading saved covers…
            </p>
          ) : (
            <>
              <fieldset disabled={unavailable} className="space-y-3">
                <UploadZone send={target} noun="cover" multiple={false} />
                <button
                  type="button"
                  onClick={() => setShowUrl((v) => !v)}
                  aria-expanded={showUrl}
                  className="flex items-center gap-1 text-xs text-fg-secondary cursor-pointer hover:text-fg-primary pointer-coarse:min-h-11"
                >
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
                    className="flex items-center gap-2"
                  >
                    <Input
                      ref={urlField}
                      type="url"
                      aria-label="Image URL"
                      placeholder="Paste image URL..."
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      disabled={urlBusy}
                      className="flex-1"
                    />
                    <Button type="submit"
                      size="sm"
                      variant="secondary"
                      busy={urlBusy}
                      disabled={!url.trim()}
                      data-shortcut="save"
                    >
                      Add
                    </Button>
                  </form>
                )}
              </fieldset>
              <div className="flex flex-wrap items-center gap-2">
                {ownKey && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={unavailable || !bookCover}
                    onClick={() => void useBookCover()}
                  >
                    Use the book&apos;s cover
                  </Button>
                )}
                {(ownKey || poster) && (
                  <ImageAdjustButton
                    source={mediaUrl(ownKey ?? poster!.s3Key)}
                    editionId={edition.id}
                    disabled={unavailable}
                    label="Adjust edition cover"
                    appearance="ghost"
                    onSaved={() => void changed()}
                  />
                )}
                {ownKey && !bookCover && (
                  <span className="text-xs text-fg-secondary">
                    The book has no cover to use.
                  </span>
                )}
              </div>
              <section className="space-y-2">
                <h3
                  ref={historyHeading}
                  tabIndex={-1}
                  className="text-sm font-medium text-fg-primary"
                >
                  Earlier covers
                </h3>
                {previous.length ? (
                  <div className="space-y-2">
                    {previous.map((cover) => (
                      <Button
                        key={cover.id}
                        variant="ghost"
                        disabled={unavailable}
                        onClick={() => void restore(cover.id)}
                        className="h-auto w-full justify-start gap-3 whitespace-normal py-2 text-left"
                      >
                        <EditionImageBox
                          image={editionImage(cover)}
                          title={edition.title}
                          size="sm"
                        />
                        <span>
                          Use cover from{" "}
                          {new Date(cover.createdAt).toLocaleDateString()}
                        </span>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-fg-secondary">
                    No earlier covers yet.
                  </p>
                )}
                {choices.hasMore && (
                  <Button
                    variant="secondary"
                    disabled={unavailable}
                    onClick={() => void more()}
                  >
                    More covers
                  </Button>
                )}
              </section>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
