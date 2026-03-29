"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { RotateCcw, Save, Loader2, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CropValues {
  cropX: number;
  cropY: number;
  cropZoom: number;
}

interface MediaCropEditorProps {
  imageUrl: string;
  aspect: "poster" | "background";
  initial: CropValues;
  saving: boolean;
  onSave: (values: CropValues) => void;
}

const ASPECT_RATIOS: Record<string, number> = {
  poster: 2 / 3,
  background: 16 / 9,
};

export function MediaCropEditor({
  imageUrl,
  aspect,
  initial,
  saving,
  onSave,
}: MediaCropEditorProps) {
  const [cropX, setCropX] = useState(initial.cropX);
  const [cropY, setCropY] = useState(initial.cropY);
  const [cropZoom, setCropZoom] = useState(initial.cropZoom);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Reset internal state when initial values change (e.g. switching active item)
  useEffect(() => {
    setCropX(initial.cropX);
    setCropY(initial.cropY);
    setCropZoom(initial.cropZoom);
  }, [initial.cropX, initial.cropY, initial.cropZoom]);

  const isDirty =
    cropX !== initial.cropX ||
    cropY !== initial.cropY ||
    cropZoom !== initial.cropZoom;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };

      const sensitivity = 80 / (cropZoom / 100);
      const deltaX = -(dx / rect.width) * sensitivity;
      const deltaY = -(dy / rect.height) * sensitivity;

      setCropX((prev) => Math.max(0, Math.min(100, prev + deltaX)));
      setCropY((prev) => Math.max(0, Math.min(100, prev + deltaY)));
    },
    [cropZoom],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  function handleReset() {
    setCropX(50);
    setCropY(50);
    setCropZoom(100);
  }

  const ratio = ASPECT_RATIOS[aspect] ?? 2 / 3;
  const previewHeight = aspect === "poster" ? 320 : 220;
  const previewWidth = Math.round(previewHeight * ratio);

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-fg-secondary">
        Adjust position
      </p>

      {/* Preview — fixed dimensions preserving exact aspect ratio */}
      <div
        ref={containerRef}
        className="relative mx-auto cursor-grab overflow-hidden rounded-sm border border-glass-border active:cursor-grabbing"
        style={{ width: previewWidth, height: previewHeight }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src={imageUrl}
          alt="Crop preview"
          draggable={false}
          className="h-full w-full select-none object-cover"
          style={{
            objectPosition: `${cropX}% ${cropY}%`,
            transform: `scale(${cropZoom / 100})`,
            transformOrigin: `${cropX}% ${cropY}%`,
          }}
        />
        {/* Crosshair guides */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/10" />
        </div>
      </div>

      {/* Controls — below the preview, single row that wraps */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Zoom slider */}
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <ZoomIn className="h-3 w-3 shrink-0 text-fg-muted" strokeWidth={1.5} />
          <input
            type="range"
            min={100}
            max={300}
            step={1}
            value={cropZoom}
            onChange={(e) => setCropZoom(Number(e.target.value))}
            className="crop-range-slider flex-1"
          />
          <span className="w-10 shrink-0 text-right font-mono text-micro text-fg-muted">
            {cropZoom}%
          </span>
        </div>

        {/* Position readout */}
        <div className="flex items-center gap-3">
          <span className="text-micro text-fg-muted">
            X <span className="font-mono text-fg-secondary">{cropX.toFixed(1)}%</span>
          </span>
          <span className="text-micro text-fg-muted">
            Y <span className="font-mono text-fg-secondary">{cropY.toFixed(1)}%</span>
          </span>
        </div>

        {/* Buttons */}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={saving}
          >
            <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
            Reset
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSave({ cropX, cropY, cropZoom })}
            disabled={!isDirty || saving}
          >
            {saving ? (
              <Loader2
                className="h-3 w-3 animate-spin"
                strokeWidth={1.5}
              />
            ) : (
              <Save className="h-3 w-3" strokeWidth={1.5} />
            )}
            Save position
          </Button>
        </div>
      </div>
    </div>
  );
}
