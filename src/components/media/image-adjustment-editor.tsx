"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, Lock, RotateCcw, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MAX_STRAIGHTEN, nextTurn, rotatedFrame } from "@/lib/media/crop";
import {
  getImagePresentation,
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
import { saveImagePresentation } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

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
  { key: "straighten", label: "Straighten", min: -MAX_STRAIGHTEN, max: MAX_STRAIGHTEN, step: 1, unit: "°", group: "framing" },
] as const;
const CROP_DEFAULTS = { cropX: 50, cropY: 50, cropZoom: 100, turn: 0, straighten: 0 };

/** The preview's longest side, scaled down once when it is turned */
const PREVIEW_SIDE = 1200;

/**
 * The image scaled down to at most 1200px on its long side, once per image,
 * ready to be drawn turned. Loaded only once the image is turned.
 */
function useScaledImage(src: string, wanted: boolean): HTMLCanvasElement | null {
  const [scaled, setScaled] = useState<{ src: string; canvas: HTMLCanvasElement } | null>(null);
  const ready = scaled?.src === src;
  useEffect(() => {
    if (!wanted || ready) return;
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live || !img.naturalWidth) return;
      const k = Math.min(1, PREVIEW_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingQuality = "high";
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      setScaled({ src, canvas });
    };
    img.src = src;
    return () => {
      live = false;
    };
  }, [src, wanted, ready]);
  return ready ? scaled.canvas : null;
}

/**
 * The preview turned and straightened as Save writes it (SLN-333): the
 * largest centred box left by the rotation, which the crop then frames as it
 * frames an upright image. Each step of a slider only draws the scaled image
 * turned on a canvas, with nothing encoded, so the preview keeps up with the
 * slider on a slow phone; the full-size file is written on Save.
 */
function AdjustmentPreview({
  src,
  turn,
  straighten,
  className,
  style,
}: {
  src: string;
  turn: number;
  straighten: number;
  className: string;
  style: React.CSSProperties;
}) {
  const turned = !!turn || !!straighten;
  const scaled = useScaledImage(src, turned);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = turned && !!scaled;
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!drawn || !el || !scaled) return;
    const frame = rotatedFrame(scaled.width, scaled.height, turn, straighten);
    // Setting the size clears the canvas and its transform
    el.width = Math.max(1, Math.floor(frame.width));
    el.height = Math.max(1, Math.floor(frame.height));
    const context = el.getContext("2d");
    if (!context) return;
    context.translate(el.width / 2, el.height / 2);
    context.rotate(((turn + straighten) * Math.PI) / 180);
    context.drawImage(scaled, -scaled.width / 2, -scaled.height / 2);
  }, [drawn, scaled, turn, straighten]);
  // Upright, or until the turned image is ready: the image itself
  if (!drawn)
    return (
      <img
        data-adjustment-preview
        src={src}
        alt="Image adjustment preview"
        draggable={false}
        className={className}
        style={style}
      />
    );
  return (
    <canvas
      ref={canvas}
      data-adjustment-preview
      role="img"
      aria-label="Image adjustment preview"
      className={className}
      style={style}
    />
  );
}

/** A value as its slider steps: "+0.35 EV", "120%", "1.5 px" */
function formatValue(value: number, step: number, unit: string, signed: boolean) {
  const decimals = step < 1 ? String(step).split(".")[1]?.length ?? 0 : 0;
  const text = value.toFixed(decimals);
  return `${signed && value > 0 ? "+" : ""}${text}${unit}`;
}

/**
 * Unsaved work the editor's owner can save: a save that resolves true when
 * it stored the work, or null while there is nothing to save
 */
export type DraftSave = (() => Promise<boolean>) | null;

function LoadedEditor({
  initial,
  onSaved,
  onDraft,
  pinned,
}: {
  initial: Presentation;
  /** In its own dialog: the actions sit under the body */
  pinned: boolean;
  /** After a save, with the image's new source */
  onSaved?: (source: string) => void;
  onDraft?: (save: DraftSave) => void;
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
  const saveButton = useRef<HTMLButtonElement>(null);
  const firstControl = useRef<HTMLInputElement>(null);
  // Saved from Save: once saved it has nothing to save and turns off, so the
  // focus goes to the open group's first control instead of the page
  const [refocus, setRefocus] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const update = useImageAdjustmentUpdate();
  const router = useRouter();
  const id = useId();
  // Author monochrome locks the colour controls; only a cropped subject frames.
  // A painting or a perfume is shown whole: it turns and straightens only
  const framed = !!crop && !initial.contained;
  const available = [
    ...controls.filter(
      (control) => !(initial.monochrome && control.group === "colour"),
    ),
    ...(crop ? cropControls.filter((control) => framed || control.key === "straighten") : []),
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

  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    const fromSave = document.activeElement === saveButton.current;
    try {
      const record = await saveImagePresentation(source, {
        settings,
        ...(crop ? { crop } : {}),
      });
      const next = s3ImageSource(record.assetKey);
      setSource(next);
      update(record);
      setBaseline({ settings: record.settings, crop });
      setSettings(record.settings);
      toast.success("Image adjustments saved");
      router.refresh();
      onSaved?.(next);
      if (fromSave) setRefocus(true);
      return true;
    } catch (error) {
      toast.error(refusalMessage(error, "Could not save image adjustments. Your changes are still here."));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  useLayoutEffect(() => {
    if (!refocus || saving) return;
    setRefocus(false);
    firstControl.current?.focus();
  }, [refocus, saving]);

  // The owner (the media manager) asks before a close or a switch would lose
  // the work, and its Save saves it here
  const latestSave = useRef(save);
  useLayoutEffect(() => {
    latestSave.current = save;
  });
  useEffect(() => {
    onDraft?.(dirty ? () => latestSave.current() : null);
  }, [dirty, onDraft]);
  useEffect(() => () => onDraft?.(null), [onDraft]);

  return (
    <div className="space-y-4">
      <div
        className={`mx-auto overflow-hidden rounded-sm border border-glass-border bg-bg-primary ${framed ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={(event) => {
          if (!framed || saving) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY };
          setCompare(false);
        }}
        onPointerMove={(event) => {
          if (!drag.current || !crop || !framed || saving) return;
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
        <AdjustmentPreview
          src={initial.preview}
          turn={previewCrop?.turn ?? 0}
          straighten={previewCrop?.straighten ?? 0}
          className={`h-full w-full ${previewCrop && framed ? "object-cover" : "object-contain"}`}
          style={{
            filter: imageAdjustmentFilter(previewSettings, initial.monochrome),
            ...(previewCrop && framed
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
      <div className="space-y-3">
      <fieldset disabled={saving} className="space-y-3">
        <legend className="sr-only">Image adjustments</legend>
        {/* One group at a time, every control in it in view: a label, its
            value (brighter once it moves off the default) and its slider.
            A lone group (author monochrome, no crop) needs no switch */}
        {groups.length > 1 && (
          <SegmentedControl
            options={groups}
            value={shown}
            onChange={setGroup}
            ariaLabel="Adjustments"
            disabled={saving}
          />
        )}
        <div className="space-y-4 pointer-coarse:space-y-0">
          {available
            .filter((control) => control.group === shown)
            .map((control, index) => {
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
                    ref={index === 0 ? firstControl : undefined}
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
          {shown === "framing" && crop && (
            // Quarter turns; the slider above straightens within 45 degrees
            <div className="-ml-2.5 flex gap-2">
              {([
                [-90, "Turn left", RotateCcw],
                [90, "Turn right", RotateCw],
              ] as const).map(([by, label, Icon]) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setCrop((previous) => previous && { ...previous, turn: nextTurn(previous.turn, by) })
                  }
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </fieldset>
        {/* Outside the locked fieldset: Save keeps the focus while it saves,
            reading as busy, never disabled (docs/03, busy controls) */}
        <ActionRow pinned={pinned}>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            // Its label starts on the sliders' edge (docs/03, Spacing Scale),
            // and Reset all and Save keep to the end
            className="-ml-2.5 mr-auto"
            disabled={saving}
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
              disabled={saving}
              onClick={() => {
                setSettings(
                  enforceImagePolicy(
                    { ...DEFAULT_IMAGE_ADJUSTMENTS },
                    initial.monochrome,
                  ),
                );
                if (crop) setCrop({ ...CROP_DEFAULTS });
                setCompare(false);
              }}
            >
              Reset all
            </Button>
            <Button
              ref={saveButton}
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
        </ActionRow>
      </div>
    </div>
  );
}

/**
 * The editor's Compare, Reset all and Save. In the editor's own dialog they
 * sit under its body, always in view (SLN-1056); in the media manager, which
 * has more under the editor, they follow the sliders.
 */
function ActionRow({ pinned, children }: { pinned: boolean; children: ReactNode }) {
  if (pinned) return <DialogFooter>{children}</DialogFooter>;
  return <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>;
}

export function ImageAdjustmentEditor({
  source,
  onSaved,
  onDraft,
  pinned = false,
}: {
  source: string;
  /** In a dialog of its own, its actions sit under the body, always in view (SLN-1056) */
  pinned?: boolean;
  onSaved?: () => void;
  /** The editor's unsaved work, for an owner that asks before losing it */
  onDraft?: (save: DraftSave) => void;
}) {
  const [result, setResult] = useState<{
    source: string;
    /** The editor's key: the source it was opened on */
    key: string;
    data?: Presentation;
    error?: boolean;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The file this editor's own save wrote. When the owner hands it back as
  // the new source, the editor stays open as it is, on the same group and
  // control, and only its picture of the stored image is brought up to date
  const [written, setWritten] = useState<string | null>(null);
  const own = written === source;
  useEffect(() => {
    let cancelled = false;
    getImagePresentation(source)
      .then((data) => {
        if (!cancelled)
          setResult((previous) => ({ source, key: own && previous ? previous.key : source, data }));
      })
      .catch(() => {
        if (!cancelled && !own) setResult({ source, key: source, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [source, attempt, own]);
  if (!result || (result.source !== source && !(own && result.data)))
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
  return (
    <LoadedEditor
      key={result.key}
      initial={result.data}
      onSaved={(next) => {
        setWritten(next);
        onSaved?.();
      }}
      onDraft={onDraft}
      pinned={pinned}
    />
  );
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
            pinned
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
