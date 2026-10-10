"use client";

import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { CoarseImageSource } from "./coarse-image-source";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, open, onClose }: ImageLightboxProps) {
  if (!open) return null;
  return createPortal(
    <OpenImageLightbox key={src} src={src} alt={alt} onClose={onClose} />,
    document.body,
  );
}

function OpenImageLightbox({
  src,
  alt,
  onClose,
}: Omit<ImageLightboxProps, "open">) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // React creates the img before assembling its picture. Set the canonical
  // source only after insertion, so a coarse pointer never fetches it first.
  const attachImage = useCallback((image: HTMLImageElement | null) => {
    if (image) image.src = src;
  }, [src]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function handleKey(e: KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const buttons = [
        ...(rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? []),
      ];
      const first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="image-lightbox fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-scrim-deep"
        onClick={onClose}
        aria-hidden="true"
      />
      <ImageAdjustButton
        source={src}
        className="absolute right-16 top-4 z-20"
      />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close image"
        data-tooltip="Close image"
        className="action-icon-sm absolute right-4 top-4 z-20 text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <div
        className="image-lightbox-frame relative z-10 flex h-[calc(100dvh-8rem)] w-[90vw] items-center justify-center"
        aria-busy={status === "loading"}
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {status !== "loaded" && (
          <p
            role={status === "error" ? "alert" : "status"}
            className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-fg-secondary"
          >
            {status === "error"
              ? "Could not load this image."
              : "Loading image…"}
          </p>
        )}
        <div
          className="relative"
          onClick={status === "loaded" ? (e) => e.stopPropagation() : undefined}
        >
          <picture className="contents">
            <CoarseImageSource src={src} />
            <img
              ref={attachImage}
              alt={alt}
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("error")}
              className="protected-image block h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-[90vw] rounded-sm object-contain"
              style={{ visibility: status === "loaded" ? "visible" : "hidden" }}
            />
          </picture>
          {status === "loaded" && (
            <div
              data-image-protection=""
              className="absolute inset-0"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      <style>{`
        .image-lightbox { animation: lightbox-fade-in 200ms ease forwards; }
        .image-lightbox-frame { animation: lightbox-scale-in 200ms ease forwards; }
        @keyframes lightbox-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes lightbox-scale-in { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @media (pointer: coarse) {
          .image-lightbox, .image-lightbox-frame { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
