"use client";

import { Fragment, useState, useRef, useCallback, useEffect, useId } from "react";
import { RotateCcw, Save, Loader2, ZoomIn, Sun, Contrast } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mediaFilter } from "@/lib/utils/media-style";

interface CropValues {
  cropX: number;
  cropY: number;
  cropZoom: number;
  /** Percent, 100 = unchanged */
  brightness: number;
  /** Percent, 100 = unchanged */
  contrast: number;
}

/** Slider range for zoom, in percent */
const ZOOM_MIN = 100;
const ZOOM_MAX = 300;

/** Slider range for brightness and contrast, in percent */
const ADJUST_MIN = 50;
const ADJUST_MAX = 150;

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
  const [brightness, setBrightness] = useState(initial.brightness);
  const [contrast, setContrast] = useState(initial.contrast);

  const idPrefix = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  // Reset internal state when initial values change (e.g. switching active item)
  useEffect(() => {
    setCropX(initial.cropX);
    setCropY(initial.cropY);
    setCropZoom(initial.cropZoom);
    setBrightness(initial.brightness);
    setContrast(initial.contrast);
  }, [initial.cropX, initial.cropY, initial.cropZoom, initial.brightness, initial.contrast]);

  const isDirty =
    cropX !== initial.cropX ||
    cropY !== initial.cropY ||
    cropZoom !== initial.cropZoom ||
    brightness !== initial.brightness ||
    contrast !== initial.contrast;

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
    setBrightness(100);
    setContrast(100);
  }

  const ratio = ASPECT_RATIOS[aspect] ?? 2 / 3;
  const previewHeight = aspect === "poster" ? 320 : 220;
  const previewWidth = Math.round(previewHeight * ratio);

  const sliders = [
    { key: "zoom", label: "Zoom", Icon: ZoomIn, min: ZOOM_MIN, max: ZOOM_MAX, value: cropZoom, onChange: setCropZoom },
    { key: "brightness", label: "Brightness", Icon: Sun, min: ADJUST_MIN, max: ADJUST_MAX, value: brightness, onChange: setBrightness },
    { key: "contrast", label: "Contrast", Icon: Contrast, min: ADJUST_MIN, max: ADJUST_MAX, value: contrast, onChange: setContrast },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-fg-secondary">
        Adjust position, brightness and contrast
      </p>

      {/* Preview — exact aspect ratio, shrinks to fit narrow screens */}
      <div
        ref={containerRef}
        className="relative mx-auto max-w-full cursor-grab touch-none overflow-hidden rounded-sm border border-glass-border active:cursor-grabbing"
        style={{ width: previewWidth, aspectRatio: String(ratio) }}
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
            filter: mediaFilter({ x: cropX, y: cropY, zoom: cropZoom, brightness, contrast }),
          }}
        />
        {/* Crosshair guides */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/10" />
          <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/10" />
        </div>
      </div>

      {/* Controls — one row per slider, stacked; the value column grows to fit */}
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] items-center gap-x-3 gap-y-3">
          {sliders.map(({ key, label, Icon, min, max, value, onChange }) => {
            const id = `${idPrefix}-${key}`;
            return (
              <Fragment key={key}>
                <label htmlFor={id} className="flex items-center gap-2 text-xs text-fg-secondary">
                  <Icon className="h-3 w-3 shrink-0 text-fg-muted" strokeWidth={1.5} aria-hidden />
                  {label}
                </label>
                <input
                  id={id}
                  type="range"
                  min={min}
                  max={max}
                  step={1}
                  value={value}
                  onChange={(e) => onChange(Number(e.target.value))}
                  className="crop-range-slider w-full"
                  aria-label={label}
                />
                <output
                  htmlFor={id}
                  className="min-w-[4ch] text-right font-mono text-micro tabular-nums text-fg-muted"
                >
                  {value}%
                </output>
              </Fragment>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Position readout */}
          <div className="flex items-center gap-3">
            <span className="text-micro text-fg-muted">
              X <span className="font-mono tabular-nums text-fg-secondary">{cropX.toFixed(1)}%</span>
            </span>
            <span className="text-micro text-fg-muted">
              Y <span className="font-mono tabular-nums text-fg-secondary">{cropY.toFixed(1)}%</span>
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
              onClick={() => onSave({ cropX, cropY, cropZoom, brightness, contrast })}
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
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
