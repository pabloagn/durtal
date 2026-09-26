"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal, Lock, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  getImagePresentation,
  saveImagePresentation,
} from "@/lib/actions/image-adjustments";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  enforceImagePolicy,
  imageAdjustmentFilter,
  imageSourceIdentity,
  type ImageAdjustments,
} from "@/lib/utils/image-adjustments";
import { useImageAdjustmentUpdate } from "./image-adjustment-provider";

type Presentation = Awaited<ReturnType<typeof getImagePresentation>>;
const controls = [
  {
    key: "exposure",
    label: "Exposure",
    min: -2,
    max: 2,
    step: 0.05,
    unit: " EV",
  },
  {
    key: "brightness",
    label: "Brightness",
    min: 0,
    max: 200,
    step: 1,
    unit: "%",
  },
  { key: "contrast", label: "Contrast", min: 0, max: 200, step: 1, unit: "%" },
  {
    key: "saturation",
    label: "Saturation",
    min: 0,
    max: 200,
    step: 1,
    unit: "%",
    color: true,
  },
  {
    key: "grayscale",
    label: "Monochrome",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    color: true,
  },
  {
    key: "sepia",
    label: "Sepia",
    min: 0,
    max: 100,
    step: 1,
    unit: "%",
    color: true,
  },
  {
    key: "softness",
    label: "Softness",
    min: 0,
    max: 8,
    step: 0.1,
    unit: " px",
  },
] as const;
const cropControls = [
  { key: "cropZoom", label: "Zoom", min: 100, max: 300, step: 1, unit: "%" },
  { key: "cropX", label: "Position X", min: 0, max: 100, step: 1, unit: "%" },
  { key: "cropY", label: "Position Y", min: 0, max: 100, step: 1, unit: "%" },
] as const;

function LoadedEditor({
  initial,
  onSaved,
}: {
  initial: Presentation;
  onSaved?: () => void;
}) {
  const [settings, setSettings] = useState(initial.settings);
  const [crop, setCrop] = useState(initial.crop);
  const [active, setActive] = useState("exposure");
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState({
    settings: initial.settings,
    crop: initial.crop,
  });
  const savingRef = useRef(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const update = useImageAdjustmentUpdate();
  const router = useRouter();
  const id = useId();
  const available = [
    ...controls.filter(
      (control) => !(initial.monochrome && "color" in control),
    ),
    ...(crop ? cropControls : []),
  ];
  const control = available.find((item) => item.key === active) ?? available[0];
  const value =
    control.key in settings
      ? settings[control.key as keyof ImageAdjustments]
      : crop![control.key as keyof NonNullable<typeof crop>];
  const dirty = JSON.stringify({ settings, crop }) !== JSON.stringify(baseline);
  const previewSettings = compare ? baseline.settings : settings;
  const previewCrop = compare ? baseline.crop : crop;

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const record = await saveImagePresentation(initial.source, {
        settings,
        ...(crop ? { crop } : {}),
      });
      update(record);
      setBaseline({ settings: record.settings, crop });
      setSettings(record.settings);
      toast.success("Image adjustments saved");
      router.refresh();
      onSaved?.();
    } catch {
      toast.error(
        "Could not save image adjustments. Your changes are still here.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className={`mx-auto overflow-hidden rounded-sm border border-glass-border bg-bg-primary ${crop ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={(event) => {
          if (!crop || saving) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY };
          setCompare(false);
        }}
        onPointerMove={(event) => {
          if (!drag.current || !crop || saving) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const dx =
            (((event.clientX - drag.current.x) / rect.width) * 80) /
            (crop.cropZoom / 100);
          const dy =
            (((event.clientY - drag.current.y) / rect.height) * 80) /
            (crop.cropZoom / 100);
          drag.current = { x: event.clientX, y: event.clientY };
          setCrop(
            (current) =>
              current && {
                ...current,
                cropX: Math.max(0, Math.min(100, current.cropX - dx)),
                cropY: Math.max(0, Math.min(100, current.cropY - dy)),
              },
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        style={{
          height: "min(30dvh, 240px)",
          ...(initial.aspect
            ? { aspectRatio: initial.aspect, maxWidth: "100%" }
            : {}),
        }}
      >
        <img
          data-adjustment-preview
          src={initial.source}
          alt="Image adjustment preview"
          draggable={false}
          className={`h-full w-full ${previewCrop ? "object-cover" : "object-contain"}`}
          style={{
            filter: imageAdjustmentFilter(previewSettings, initial.monochrome),
            ...(previewCrop
              ? {
                  objectPosition: `${previewCrop.cropX}% ${previewCrop.cropY}%`,
                  transform: `scale(${previewCrop.cropZoom / 100})`,
                  transformOrigin: `${previewCrop.cropX}% ${previewCrop.cropY}%`,
                }
              : {}),
          }}
        />
      </div>
      {initial.monochrome && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Lock className="h-3 w-3" strokeWidth={1.5} />
          Author monochrome stays on
        </p>
      )}
      <fieldset disabled={saving} className="space-y-3">
        <legend className="sr-only">Image adjustments</legend>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Choose adjustment"
        >
          {available.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={control.key === item.key}
              onClick={() => setActive(item.key)}
              className={`rounded-sm px-2 py-1 text-xs focus-visible:outline focus-visible:outline-accent-rose ${control.key === item.key ? "bg-accent-rose/20 text-fg-primary" : "text-fg-muted hover:text-fg-primary"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs">
          <label htmlFor={id}>{control.label}</label>
          <output htmlFor={id} className="font-mono text-fg-secondary">
            {value}
            {control.unit}
          </output>
        </div>
        <input
          id={id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          className="crop-range-slider w-full"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (control.key in settings)
              setSettings((previous) => ({ ...previous, [control.key]: next }));
            else
              setCrop(
                (previous) => previous && { ...previous, [control.key]: next },
              );
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={compare}
            onClick={() => setCompare((previous) => !previous)}
          >
            {compare ? "Show changes" : "Compare"}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSettings(
                  enforceImagePolicy(
                    { ...DEFAULT_IMAGE_ADJUSTMENTS },
                    initial.monochrome,
                  ),
                );
                if (crop) setCrop({ cropX: 50, cropY: 50, cropZoom: 100 });
                setCompare(false);
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}Save
            </Button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

export function ImageAdjustmentEditor({
  source,
  onSaved,
}: {
  source: string;
  onSaved?: () => void;
}) {
  const [result, setResult] = useState<{
    source: string;
    data?: Presentation;
    error?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getImagePresentation(source)
      .then((data) => {
        if (!cancelled) setResult({ source, data });
      })
      .catch(() => {
        if (!cancelled) setResult({ source, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [source, attempt]);
  if (!result || result.source !== source)
    return (
      <p className="py-8 text-center text-sm text-fg-muted" role="status">
        Loading image adjustments…
      </p>
    );
  if (!result.data)
    return (
      <div role="alert" className="space-y-2 text-sm text-fg-muted">
        <p>Could not load this image.</p>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setResult(null);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  return <LoadedEditor key={source} initial={result.data} onSaved={onSaved} />;
}

export function ImageAdjustButton({
  source,
  className = "",
  label = "Adjust image",
  onSaved,
}: {
  source: string;
  className?: string;
  label?: string;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!imageSourceIdentity(source)) return null;
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-sm border border-glass-border bg-bg-primary/85 text-fg-secondary hover:text-fg-primary focus-visible:outline focus-visible:outline-accent-rose ${className}`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      {open && (
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title={label}
          className="max-w-lg"
          expandable={false}
        >
          <ImageAdjustmentEditor
            source={source}
            onSaved={() => {
              onSaved?.();
              setOpen(false);
            }}
          />
        </Dialog>
      )}
    </>
  );
}
