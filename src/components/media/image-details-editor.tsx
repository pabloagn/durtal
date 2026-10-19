"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DraftSave } from "@/components/media/image-adjustment-editor";
import { updateMediaDetails } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

/** What an image shows and whose it is, as stored on the media row. */
export interface ImageDetails {
  altText: string | null;
  credit: string | null;
  license: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
}
type Field = keyof ImageDetails;

const URL_FIELDS: Field[] = ["licenseUrl", "sourceUrl"];

function formValues(details: ImageDetails): Record<Field, string> {
  return {
    altText: details.altText ?? "",
    credit: details.credit ?? "",
    license: details.license ?? "",
    licenseUrl: details.licenseUrl ?? "",
    sourceUrl: details.sourceUrl ?? "",
  };
}

/**
 * Edits one image's alt text, credit, license and source. The file itself is
 * never changed. An empty field clears the stored value.
 */
export function ImageDetailsEditor({
  mediaId,
  details,
  onSaved,
  onDraft,
}: {
  mediaId: string;
  details: ImageDetails;
  onSaved?: () => void;
  /** The unsaved details, for an owner that asks before losing them */
  onDraft?: (save: DraftSave) => void;
}) {
  const stored = formValues(details);
  const [values, setValues] = useState(stored);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [saving, setSaving] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // Saved from its button: once the stored details catch up the button turns
  // off, so the focus goes to the first field instead of the page
  const [refocus, setRefocus] = useState(false);
  const dirty = (Object.keys(values) as Field[]).some(
    (field) => values[field].trim() !== stored[field],
  );

  function set(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function save(): Promise<boolean> {
    const invalid = Object.fromEntries(
      URL_FIELDS.filter(
        (field) =>
          values[field].trim() && !/^https?:\/\/\S+$/.test(values[field].trim()),
      ).map((field) => [field, "Use a web address starting with http:// or https://"]),
    );
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return false;
    }
    setSaving(true);
    const fromButton = !!form.current?.contains(document.activeElement) && document.activeElement?.getAttribute("type") === "submit";
    try {
      const value = (field: Field) => values[field].trim() || null;
      await updateMediaDetails(mediaId, {
        altText: value("altText"),
        credit: value("credit"),
        license: value("license"),
        licenseUrl: value("licenseUrl"),
        sourceUrl: value("sourceUrl"),
      });
      toast.success("Image details saved");
      onSaved?.();
      if (fromButton) setRefocus(true);
      return true;
    } catch (error) {
      toast.error(refusalMessage(error, "Could not save the image details"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  useLayoutEffect(() => {
    if (!refocus || dirty) return;
    setRefocus(false);
    form.current?.querySelector<HTMLElement>("textarea, input")?.focus();
  }, [refocus, dirty]);

  const latestSave = useRef(save);
  useLayoutEffect(() => {
    latestSave.current = save;
  });
  useEffect(() => {
    onDraft?.(dirty ? () => latestSave.current() : null);
  }, [dirty, onDraft]);
  useEffect(() => () => onDraft?.(null), [onDraft]);

  return (
    // noValidate: the form shows its own link errors, in the app's style.
    <form
      ref={form}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate className="space-y-3" aria-label="Image details">
      <p className="text-xs font-medium text-fg-secondary">Image details</p>
      <Textarea
        label="Alt text"
        placeholder="Describe what the image shows"
        maxLength={1000}
        value={values.altText}
        onChange={(e) => set("altText", e.target.value)}
        className="min-h-[60px]"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Credit"
          placeholder="Photographer, museum or collection"
          maxLength={500}
          value={values.credit}
          onChange={(e) => set("credit", e.target.value)}
        />
        <Input
          label="License"
          placeholder="Public domain, CC BY-SA 4.0…"
          maxLength={200}
          value={values.license}
          onChange={(e) => set("license", e.target.value)}
        />
        <Input
          label="License link"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={values.licenseUrl}
          error={errors.licenseUrl}
          onChange={(e) => set("licenseUrl", e.target.value)}
        />
        <Input
          label="Source link"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={values.sourceUrl}
          error={errors.sourceUrl}
          onChange={(e) => set("sourceUrl", e.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" busy={saving} disabled={!dirty}>
          Save details
        </Button>
      </div>
    </form>
  );
}
