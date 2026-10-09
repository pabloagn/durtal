"use client";

import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import { ImageRotationFrame } from "./image-rotation-frame";
import { isImageRotation } from "@/lib/media/rotation";
import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
  rotation?: number;
}

interface LightboxProps {
  images: LightboxImage[];
  initialIndex: number;
  onClose: () => void;
}

export function Lightbox({ images, initialIndex, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("dialog") !== dialogRef.current
      )
        return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev]);

  const current = images[index];
  const rotation = current.rotation ?? 0;
  const rotated = isImageRotation(rotation) && rotation !== 0;
  const image = (
    <Image
      src={current.src}
      alt={current.alt}
      width={1600}
      height={1200}
      className="max-h-[85vh] w-auto object-contain"
      priority
      unoptimized
    />
  );

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 h-screen w-screen max-h-none max-w-none bg-scrim-deep p-0 backdrop:bg-transparent"
      onClose={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex h-full w-full items-center justify-center">
        <ImageAdjustButton
          key={current.src}
          source={current.src}
          className="absolute right-16 top-4 z-20"
        />
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close image"
          data-tooltip="Close image"
          className="absolute right-4 top-4 z-10 rounded-sm p-1.5 text-fg-secondary transition-colors hover:text-fg-primary"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>

        {/* Nav prev */}
        {images.length > 1 && (
          <button
            aria-label="Previous image"
            data-tooltip="Previous image"
            onClick={goPrev}
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-sm p-2 text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}

        {/* Image */}
        <div
          className={
            rotated
              ? "relative flex max-h-[90dvh] flex-col"
              : "relative max-h-[90vh] max-w-[90vw]"
          }
          style={
            rotated
              ? {
                  width: "min(90vw, calc(100vw - 96px))",
                  height: "calc(100dvh - 96px)",
                }
              : undefined
          }
        >
          {rotated ? (
            <div className="relative min-h-0 flex-1">
              <ImageRotationFrame
                rotation={rotation}
                src={current.src}
                original={image}
                renderImage={(binding) => (
                  <Image
                    {...binding}
                    alt={current.alt}
                    width={1600}
                    height={1200}
                    priority
                    unoptimized
                  />
                )}
              />
            </div>
          ) : (
            image
          )}
          {current.caption && (
            <p
              className={
                rotated
                  ? "mt-3 max-h-[25dvh] shrink-0 overflow-y-auto text-center text-xs text-fg-secondary"
                  : "mt-3 text-center text-xs text-fg-secondary"
              }
            >
              {current.caption}
            </p>
          )}
        </div>

        {/* Nav next */}
        {images.length > 1 && (
          <button
            aria-label="Next image"
            data-tooltip="Next image"
            onClick={goNext}
            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-sm p-2 text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}

        {/* Counter */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs text-fg-secondary">
            {index + 1} / {images.length}
          </div>
        )}
      </div>
    </dialog>
  );
}
