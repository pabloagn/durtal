"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SlidersHorizontal, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  getImagePresentation,
  saveImagePresentation,
} from "@/lib/actions/image-adjustments";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  enforceImagePolicy,
  imageAdjustmentFilter,
  imageSourceIdentity,
  s3ImageSource,
  type ImageAdjustments,
} from "@/lib/utils/image-adjustment-css";
import { useImageAdjustmentUpdate } from "./image-adjustment-provider";

type Presentation = Awaited<ReturnType<typeof getImagePresentation>>;
type Group = "tone" | "colour" | "framing";

// Three groups, each shown whole: the light of the image, its colour, and
// (for a cropped subject) what part of it the frame shows
const GROUPS: readonly { value: Group; label: string }[] = [
  { value: "tone", label: "Tone" },
  { value: "colour", label: "Colour" },
  { value: "framing", label: "Framing" },
];
const controls = [
  { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, unit: " EV", group: "tone" },
  { key: "brightness", label: "Brightness", min: 0, max: 200, step: 1, unit: "%", group: "tone" },
  { key: "contrast", label: "Contrast", min: 0, max: 200, step: 1, unit: "%", group: "tone" },
  { key: "softness", label: "Softness", min: 0, max: 8, step: 0.1, unit: " px", group: "tone" },
  { key: "saturation", label: "Saturation", min: 0, max: 200, step: 1, unit: "%", group: "colour" },
  { key: "grayscale", label: "Monochrome", min: 0, max: 100, step: 1, unit: "%", group: "colour" },
  { key: "sepia", label: "Sepia", min: 0, max: 100, step: 1, unit: "%", group: "colour" },
] as const;
const cropControls = [
  { key: "cropZoom", label: "Zoom", min: 100, max: 300, step: 1, unit: "%", group: "framing" },
  { key: "cropX", label: "Horizontal", min: 0, max: 100, step: 1, unit: "%", group: "framing" },
  { key: "cropY", label: "Vertical", min: 0, max: 100, step: 1, unit: "%", group: "framing" },
] as const;
const CROP_DEFAULTS = { cropX: 50, cropY: 50, cropZoom: 100 };

/** A value as its slider steps: "+0.35 EV", "120%", "1.5 px" */
function formatValue(value: number, step: number, unit: string, signed: boolean) {
  const decimals = step < 1 ? String(step).split(".")[1]?.length ?? 0 : 0;
  const text = value.toFixed(decimals);
  return `${signed && value > 0 ? "+" : ""}${text}${unit}`;
}

function LoadedEditor({
  initial,
  onSaved,
}: {
  initial: Presentation;
  onSaved?: () => void;
}) {
  // A saved crop writes new files, so the image key can change after a save
  const [source, setSource] = useState(initial.source);
  const [settings, setSettings] = useState(initial.settings);
  const [crop, setCrop] = useState(initial.crop);
  const [group, setGroup] = useState<Group>("tone");
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
  // Author monochrome locks the colour controls; only a cropped subject frames
  const available = [
    ...controls.filter(
      (control) => !(initial.monochrome && control.group === "colour"),
    ),
    ...(crop ? cropControls : []),
  ];
  const groups = GROUPS.filter((item) =>
    available.some((control) => control.group === item.value),
  );
  const shown = groups.some((item) => item.value === group) ? group : groups[0].value;
  const valueOf = (key: string) =>
    key in settings
      ? settings[key as keyof ImageAdjustments]
      : crop![key as keyof NonNullable<typeof crop>];
  const defaultOf = (key: string) =>
    key in settings
      ? enforceImagePolicy({ ...DEFAULT_IMAGE_ADJUSTMENTS }, initial.monochrome)[key as keyof ImageAdjustments]
      : CROP_DEFAULTS[key as keyof typeof CROP_DEFAULTS];
  const dirty = JSON.stringify({ settings, crop }) !== JSON.stringify(baseline);
  const previewSettings = compare ? baseline.settings : settings;
  const previewCrop = compare ? baseline.crop : crop;

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const record = await saveImagePresentation(source, {
        settings,
        ...(crop ? { crop } : {}),
      });
      setSource(s3ImageSource(record.assetKey));
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
          src={initial.preview}
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
        <p className="flex items-center gap-1.5 text-xs text-fg-secondary">
          <Lock className="h-3 w-3" strokeWidth={1.5} />
          Author monochrome stays on
        </p>
      )}
      <fieldset disabled={saving} className="space-y-3">
        <legend className="sr-only">Image adjustments</legend>
        {/* One group at a time, every control in it in view: a label, its
            value (brighter once it moves off the default) and its slider */}
        <SegmentedControl
          options={groups}
          value={shown}
          onChange={setGroup}
          ariaLabel="Adjustments"
          disabled={saving}
        />
        <div className="space-y-4 pointer-coarse:space-y-0">
          {available
            .filter((control) => control.group === shown)
            .map((control) => {
              const value = valueOf(control.key);
              const changed = value !== defaultOf(control.key);
              return (
                <div key={control.key}>
                  <div className="flex items-baseline justify-between gap-3 text-xs leading-5">
                    <label htmlFor={`${id}-${control.key}`} className="text-fg-secondary">
                      {control.label}
                    </label>
                    <output
                      htmlFor={`${id}-${control.key}`}
                      className={`font-mono tabular-nums ${changed ? "text-fg-primary" : "text-fg-secondary"}`}
                    >
                      {formatValue(value, control.step, control.unit, control.min < 0)}
                    </output>
                  </div>
                  <input
                    id={`${id}-${control.key}`}
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    // A block, so no line box adds space above it; with a mouse the
                    // 14px thumb needs room under the label, on touch the 44px
                    // slider holds it
                    className="crop-range-slider mt-2.5 block w-full pointer-coarse:mt-0"
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
                </div>
              );
            })}
        </div>
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
              Reset all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              busy={saving}
              disabled={!dirty}
              onClick={save}
            >
              Save
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
      <p className="py-8 text-center text-sm text-fg-secondary" role="status">
        Loading image adjustments…
      </p>
    );
  if (!result.data)
    return (
      <div role="alert" className="space-y-2 text-sm text-fg-secondary">
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
  appearance = "glass",
  onSaved,
}: {
  source: string;
  className?: string;
  label?: string;
  appearance?: "glass" | "ghost";
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!imageSourceIdentity(source)) return null;
  return (
    <>
      <button
        type="button"
        data-tooltip={label}
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={`${appearance === "glass" ? "chip-button glass-chip" : "action-icon-sm"} ${className}`}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} />
      </button>
      {open && (
        <Dialog
          draft
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
