"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
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
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev]);

  const current = images[index];

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 h-screen w-screen max-h-none max-w-none bg-bg-primary/95 p-0 backdrop:bg-transparent"
      onClose={onClose}
    >
      <div className="flex h-full w-full items-center justify-center">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-sm p-2 text-fg-muted transition-colors hover:text-fg-primary"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>

        {/* Nav prev */}
        {images.length > 1 && (
          <button
            onClick={goPrev}
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-sm p-2 text-fg-muted transition-colors hover:text-fg-primary"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={1.5} />
          </button>
        )}

        {/* Image */}
        <div className="relative max-h-[90vh] max-w-[90vw]">
          <Image
            src={current.src}
            alt={current.alt}
            width={1600}
            height={1200}
            className="max-h-[85vh] w-auto object-contain"
            priority
          />
          {current.caption && (
            <p className="mt-3 text-center text-xs text-fg-secondary">
              {current.caption}
            </p>
          )}
        </div>

        {/* Nav next */}
        {images.length > 1 && (
          <button
            onClick={goNext}
            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-sm p-2 text-fg-muted transition-colors hover:text-fg-primary"
          >
            <ChevronRight className="h-6 w-6" strokeWidth={1.5} />
          </button>
        )}

        {/* Counter */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-xs text-fg-muted">
            {index + 1} / {images.length}
          </div>
        )}
      </div>
    </dialog>
  );
}
