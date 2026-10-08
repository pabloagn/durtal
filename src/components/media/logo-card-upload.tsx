"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { LogoCardOptions } from "@/lib/media/logo-card-options";

/** Where the logo comes from: a dropped file, or a saved card's kept original */
export type LogoSource = { file: File } | { mediaId: string; options: LogoCardOptions };

const ACCEPT = "image/svg+xml,image/png,image/jpeg,image/webp";

const SWITCHES: { key: "invert" | "keepColours" | "emblemOnly" | "badge"; label: string }[] = [
  { key: "invert", label: "Invert" },
  { key: "keepColours", label: "Keep colours" },
  { key: "emblemOnly", label: "Emblem only" },
  { key: "badge", label: "Badge" },
];
const SIZES: { value: -1 | 0 | 1; label: string }[] = [
  { value: -1, label: "Smaller" },
  { value: 0, label: "As is" },
  { value: 1, label: "Bigger" },
];

/**
 * An organization's logo card (SLN-441): drop a logo, see the finished card,
 * adjust it with the switches, save. Every card comes from one template; the
 * switches run again on the original file each time.
 */
export function LogoCardUpload({
  organizationId,
  source: initialSource = null,
  onSaved,
}: {
  organizationId: string;
  /** A saved card to adjust; without it the dialog waits for a dropped logo */
  source?: LogoSource | null;
  onSaved: () => void;
}) {
  const [source, setSource] = useState<LogoSource | null>(initialSource);
  const [options, setOptions] = useState<LogoCardOptions>(
    initialSource && "options" in initialSource ? initialSource.options : {},
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);

  useEffect(() => {
    setSource(initialSource);
    setOptions(initialSource && "options" in initialSource ? initialSource.options : {});
  }, [initialSource]);

  const form = useCallback(
    (previewOnly: boolean) => {
      const data = new FormData();
      data.set("organizationId", organizationId);
      data.set("options", JSON.stringify(options));
      if (source && "file" in source) data.set("file", source.file);
      else if (source) data.set("mediaId", source.mediaId);
      if (previewOnly) data.set("preview", "1");
      return data;
    },
    [organizationId, options, source],
  );

  // Every change of file or switch shows the card again; an older answer never wins
  useEffect(() => {
    if (!source) return;
    const id = ++request.current;
    setRendering(true);
    setError(null);
    let url: string | null = null;
    fetch("/api/media/logo-card", { method: "POST", body: form(true) })
      .then(async (res) => {
        if (id !== request.current) return;
        if (!res.ok) {
          setPreview(null);
          setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The card could not be made");
          return;
        }
        url = URL.createObjectURL(await res.blob());
        setPreview(url);
      })
      .catch(() => id === request.current && setError("The card could not be made"))
      .finally(() => id === request.current && setRendering(false));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, form]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/media/logo-card", { method: "POST", body: form(false) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The logo could not be saved");
      toast.success("Logo saved");
      setSource(null);
      setPreview(null);
      setOptions({});
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The logo could not be saved");
    } finally {
      setSaving(false);
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) {
      setOptions({});
      setSource({ file });
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files);
        }}
        className={`flex w-full flex-col items-center justify-center rounded-sm border-2 border-dashed px-4 py-6 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary ${
          dragging ? "border-accent-primary bg-accent-primary/5" : "border-glass-border hover:border-fg-muted/30"
        }`}
      >
        <Upload className="mb-2 h-4 w-4 text-fg-secondary" strokeWidth={1.5} />
        <span className="text-xs text-fg-secondary">Drop a logo here or click to browse</span>
        <span className="mt-0.5 text-xs text-fg-secondary">SVG, PNG, JPG or WebP: it becomes the house's card</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />

      {source && (
        <div className="space-y-3">
          {/* The finished card, in the card's own 3:2 frame */}
          <div className="relative aspect-[3/2] w-full overflow-hidden rounded-sm border border-glass-border bg-bg-tertiary">
            {preview && (
              // A blob URL of a card not saved yet: next/image cannot load it
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="The logo card" className="h-full w-full object-cover" />
            )}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-overlay">
                <Loader2 className="h-4 w-4 animate-spin text-fg-primary" strokeWidth={1.5} />
              </div>
            )}
          </div>
          {error && <p className="text-xs text-accent-red-text">{error}</p>}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {SWITCHES.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-xs text-fg-secondary">
                <Switch
                  checked={options[s.key] === true}
                  onCheckedChange={(on) => setOptions((o) => ({ ...o, [s.key]: on }))}
                  aria-label={s.label}
                />
                {s.label}
              </label>
            ))}
          </div>
          <div role="radiogroup" aria-label="Logo size" className="flex gap-1">
            {SIZES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={(options.size ?? 0) === s.value}
                onClick={() => setOptions((o) => ({ ...o, size: s.value }))}
                className={`h-7 rounded-sm border px-2.5 text-xs transition-colors ${
                  (options.size ?? 0) === s.value
                    ? "border-accent-primary/40 bg-accent-primary/10 text-fg-primary"
                    : "border-glass-border text-fg-secondary hover:text-fg-primary"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setSource(null);
                setPreview(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={saving || rendering || !!error || !preview}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
              Save logo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
