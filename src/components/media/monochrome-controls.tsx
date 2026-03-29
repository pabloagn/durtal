"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { DEFAULT_MONOCHROME_PARAMS, type MonochromeParams } from "@/lib/validations/media";

interface MonochromeControlsProps {
  mediaId: string;
  currentParams: MonochromeParams;
  onApply: (params: MonochromeParams) => Promise<void>;
}

export function MonochromeControls({
  mediaId,
  currentParams,
  onApply,
}: MonochromeControlsProps) {
  const [params, setParams] = useState<MonochromeParams>(currentParams);
  const [applying, setApplying] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced preview update
  const updatePreview = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewKey((k) => k + 1);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(key: keyof Omit<MonochromeParams, "grayscale">, value: number) {
    setParams((p) => ({ ...p, [key]: value }));
    updatePreview();
  }

  function handleReset() {
    setParams(DEFAULT_MONOCHROME_PARAMS);
    setPreviewKey((k) => k + 1);
  }

  async function handleApply() {
    setApplying(true);
    try {
      await onApply(params);
    } finally {
      setApplying(false);
    }
  }

  const previewUrl =
    `/api/media/preview-monochrome?mediaId=${mediaId}` +
    `&contrast=${params.contrast}&sharpness=${params.sharpness}` +
    `&gamma=${params.gamma}&brightness=${params.brightness}`;

  const hasChanges =
    params.contrast !== currentParams.contrast ||
    params.sharpness !== currentParams.sharpness ||
    params.gamma !== currentParams.gamma ||
    params.brightness !== currentParams.brightness;

  return (
    <div className="space-y-4 rounded-sm border border-glass-border bg-bg-secondary p-4">
      <div className="flex items-start gap-4">
        {/* Preview */}
        <div className="relative h-40 w-28 flex-shrink-0 overflow-hidden rounded-sm border border-glass-border bg-bg-primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={previewKey}
            src={previewUrl}
            alt="Monochrome preview"
            className="h-full w-full object-cover"
          />
        </div>

        {/* Sliders */}
        <div className="flex-1 space-y-3">
          <Slider
            label="Contrast"
            min={0.5}
            max={3.0}
            step={0.05}
            value={params.contrast}
            onChange={(v) => handleChange("contrast", v)}
          />
          <Slider
            label="Brightness"
            min={0.5}
            max={2.0}
            step={0.05}
            value={params.brightness}
            onChange={(v) => handleChange("brightness", v)}
          />
          <Slider
            label="Gamma"
            min={0.5}
            max={3.0}
            step={0.05}
            value={params.gamma}
            onChange={(v) => handleChange("gamma", v)}
          />
          <Slider
            label="Sharpness"
            min={0.0}
            max={5.0}
            step={0.1}
            value={params.sharpness}
            onChange={(v) => handleChange("sharpness", v)}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-fg-secondary"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
          Reset to defaults
        </button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleApply}
          disabled={applying || !hasChanges}
        >
          {applying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              Applying
            </>
          ) : (
            "Apply"
          )}
        </Button>
      </div>
    </div>
  );
}
