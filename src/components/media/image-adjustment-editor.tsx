"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  SlidersHorizontal,
  Lock,
  Loader2,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CapAligned } from "@/components/shared/cap-aligned";
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

type Control = (typeof controls)[number] | (typeof cropControls)[number];

function formatValue(control: Control, value: number) {
  const decimals = control.step === 0.05 ? 2 : control.step === 0.1 ? 1 : 0;
  return `${value.toFixed(decimals)}${control.unit}`;
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
  const [revision, setRevision] = useState(initial.revision);
  const [settings, setSettings] = useState(initial.settings);
  const [crop, setCrop] = useState(initial.supportsCrop ? initial.crop : null);
  const [active, setActive] = useState("exposure");
  const [openGroup, setOpenGroup] = useState<string | null>("Tone");
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState({
    settings: initial.settings,
    crop: initial.supportsCrop ? initial.crop : null,
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
  const activeControl =
    available.find((item) => item.key === active) ?? available[0];
  const groups: { label: string; controls: Control[] }[] = [
    { label: "Tone", controls: controls.filter((item) => !("color" in item)) },
    ...(!initial.monochrome
      ? [
          {
            label: "Colour",
            controls: controls.filter((item) => "color" in item),
          },
        ]
      : []),
    ...(crop ? [{ label: "Framing", controls: [...cropControls] }] : []),
  ];
  const neutralSettings = enforceImagePolicy(
    DEFAULT_IMAGE_ADJUSTMENTS,
    initial.monochrome,
  );
  function valueOf(control: Control) {
    return control.key in settings
      ? settings[control.key as keyof ImageAdjustments]
      : crop![control.key as keyof NonNullable<typeof crop>];
  }
  function neutralValue(control: Control) {
    return control.key in neutralSettings
      ? neutralSettings[control.key as keyof ImageAdjustments]
      : control.key === "cropZoom"
        ? 100
        : 50;
  }
  function change(control: Control, next: number) {
    if (control.key in settings)
      setSettings((previous) => ({ ...previous, [control.key]: next }));
    else
      setCrop((previous) => previous && { ...previous, [control.key]: next });
  }
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
        revision,
        ...(crop ? { crop } : {}),
      });
      if ("error" in record) {
        toast.error(record.message);
        return;
      }
      setSource(s3ImageSource(record.assetKey));
      setRevision(record.revision);
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
    <div className="image-editor">
      <div className="image-editor-content">
        <div className="image-editor-layout">
          <div className="min-w-0 space-y-3">
            <div
              className={`image-editor-preview ${initial.aspect && initial.aspect > 1 ? "image-editor-preview-landscape" : ""}`}
              style={
                { "--image-frame-aspect": initial.aspect ?? 1 } as CSSProperties
              }
            >
              <div
                className={`image-editor-frame ${initial.aspect ? "image-editor-frame-shaped" : ""} ${crop ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
                data-image-crop-frame={initial.supportsCrop ? "" : undefined}
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
                style={
                  {
                    ...(initial.aspect
                      ? { aspectRatio: initial.aspect }
                      : { width: "100%" }),
                  } as CSSProperties
                }
              >
                <img
                  data-adjustment-preview
                  src={initial.preview}
                  alt="Image adjustment preview"
                  draggable={false}
                  className={`h-full w-full ${initial.fit === "cover" ? "object-cover" : "object-contain"}`}
                  style={{
                    filter: imageAdjustmentFilter(
                      previewSettings,
                      initial.monochrome,
                    ),
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
            </div>
            {initial.monochrome && (
              <p className="flex gap-2 text-micro leading-5 text-fg-secondary">
                <CapAligned height={14}>
                  <Lock className="size-3.5" strokeWidth={1.5} />
                </CapAligned>
                <span>Monochrome stays on</span>
              </p>
            )}
          </div>
          <fieldset disabled={saving} className="min-w-0 space-y-3">
            <legend className="sr-only">Image adjustments</legend>
            {groups.map((group) => {
              const opened = openGroup === group.label;
              const groupId = `${id}-${group.label}`;
              return (
                <section key={group.label} className="image-editor-group">
                  <button
                    type="button"
                    id={`${groupId}-heading`}
                    aria-expanded={opened}
                    aria-controls={groupId}
                    className="image-editor-group-button"
                    onClick={() => {
                      setOpenGroup(opened ? null : group.label);
                      if (
                        !group.controls.some(
                          (item) => item.key === activeControl.key,
                        )
                      )
                        setActive(group.controls[0].key);
                    }}
                  >
                    <span className="min-w-0 flex-1 break-words">
                      {group.label}
                    </span>
                    <CapAligned height={14}>
                      <ChevronRight
                        className={`size-3.5 ${opened ? "rotate-90" : ""}`}
                        strokeWidth={1.5}
                      />
                    </CapAligned>
                  </button>
                  <div
                    id={groupId}
                    role="group"
                    aria-labelledby={`${groupId}-heading`}
                    hidden={!opened}
                  >
                    {opened &&
                      group.controls.map((item) => {
                        const selected = item.key === activeControl.key;
                        const value = valueOf(item);
                        const inputId = `${id}-${item.key}`;
                        const labelId = `${inputId}-label`;
                        return (
                          <div
                            key={item.key}
                            className={`image-editor-adjustment ${selected ? "image-editor-adjustment-active" : ""}`}
                          >
                            <div className="image-editor-control-row">
                              <button
                                type="button"
                                aria-expanded={selected}
                                aria-controls={`${inputId}-range`}
                                className="image-editor-choice"
                                onClick={() => setActive(item.key)}
                              >
                                <span
                                  id={labelId}
                                  className="min-w-0 flex-1 break-words"
                                >
                                  {item.label}
                                </span>
                                <output
                                  htmlFor={inputId}
                                  className="shrink-0 whitespace-nowrap font-mono text-micro text-fg-secondary"
                                >
                                  {formatValue(item, value)}
                                </output>
                              </button>
                              {selected && (
                                <CapAligned
                                  height={32}
                                  coarseHeight={44}
                                  className="image-editor-reset"
                                >
                                  <button
                                    type="button"
                                    className="action-icon-sm size-8 pointer-coarse:size-11"
                                    aria-label={`Reset ${item.label}`}
                                    data-tooltip={`Reset ${item.label}`}
                                    disabled={value === neutralValue(item)}
                                    onClick={() => {
                                      change(item, neutralValue(item));
                                      setCompare(false);
                                    }}
                                  >
                                    <RotateCcw
                                      className="size-4"
                                      strokeWidth={1.5}
                                    />
                                  </button>
                                </CapAligned>
                              )}
                            </div>
                            <div id={`${inputId}-range`} hidden={!selected}>
                              {selected && (
                                <div className="image-editor-range-wrap">
                                  <input
                                    id={inputId}
                                    type="range"
                                    aria-labelledby={labelId}
                                    aria-valuetext={formatValue(item, value)}
                                    min={item.min}
                                    max={item.max}
                                    step={item.step}
                                    value={value}
                                    className="image-editor-range"
                                    onChange={(event) =>
                                      change(item, Number(event.target.value))
                                    }
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </section>
              );
            })}
          </fieldset>
        </div>
      </div>
      <div className="image-editor-actions">
        <Button
          type="button"
          size="md"
          variant="ghost"
          disabled={saving}
          aria-pressed={compare}
          onClick={() => setCompare((previous) => !previous)}
        >
          {compare ? "Show changes" : "Compare"}
        </Button>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="md"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setSettings({ ...neutralSettings });
              if (crop) setCrop({ cropX: 50, cropY: 50, cropZoom: 100 });
              setCompare(false);
            }}
          >
            Reset all
          </Button>
          <Button
            type="button"
            size="md"
            variant="primary"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}Save
          </Button>
        </div>
      </div>
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
          open={open}
          onClose={() => setOpen(false)}
          title={label}
          className="max-w-3xl"
          expandable={false}
          scrollBody={false}
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
