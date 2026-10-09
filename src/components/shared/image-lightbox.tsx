"use client";

import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { ImageRotationFrame } from "@/components/media/image-rotation-frame";
import { isImageRotation } from "@/lib/media/rotation";
import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onClose: () => void;
  rotation?: number;
}

export function ImageLightbox({
  src,
  alt,
  open,
  onClose,
  rotation = 0,
}: ImageLightboxProps) {
  const rotated = isImageRotation(rotation) && rotation !== 0;
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKey);
    // Prevent body scroll while open
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, handleKey]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        animation: "lightbox-fade-in 200ms ease forwards",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-scrim-deep"
        onClick={onClose}
        aria-hidden="true"
      />

      <ImageAdjustButton
        source={src}
        className="absolute right-16 top-4 z-20"
      />
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Close image"
        data-tooltip="Close image"
        className="absolute right-4 top-4 z-10 rounded-sm p-1.5 text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {/* Image container — centered, padded, preserves aspect ratio */}
      <div
        className="relative z-10 max-h-[90vh] max-w-[90vw]"
        style={{
          animation: "lightbox-scale-in 200ms ease forwards",
          ...(rotated ? { width: "90vw", height: "calc(100dvh - 96px)" } : {}),
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <ImageRotationFrame
          rotation={rotation}
          src={src}
          original={
            <img
              src={src}
              alt={alt}
              className="protected-image block max-h-[90vh] max-w-[90vw] w-auto h-auto object-contain rounded-sm"
            />
          }
          renderImage={(binding) => (
            <img
              {...binding}
              alt={alt}
              className="protected-image block rounded-sm"
            />
          )}
        />
        {/* Invisible overlay to prevent direct image interaction */}
        <div className="absolute inset-0" aria-hidden="true" />
      </div>

      <style>{`
        @keyframes lightbox-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes lightbox-scale-in {
          from { transform: scale(0.92); opacity: 0; }
          to   { transform: scale(1);    opacity: 1; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
