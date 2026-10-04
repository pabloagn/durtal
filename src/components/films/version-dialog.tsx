"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CatalogueDateField } from "@/components/shared/catalogue-date-field";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  SingleChoiceField,
  useOrganizationSearch,
} from "@/components/catalogue/record-fields";
import { createFilmVersion, updateFilmVersion } from "@/lib/actions/films";
import { FILM_RELEASE_FORMATS, MAX_FILM_RUNTIME_SECONDS } from "@/lib/catalogue/films";
import {
  FILM_RELEASE_FORMAT_LABELS,
  formatRuntime,
  parseRuntime,
  runtimeText,
  type FilmReleaseFormat,
} from "@/lib/catalogue/film-labels";
import type { CatalogueDateInput } from "@/lib/catalogue/dates";
import { useListSearch, type Choice } from "./film-fields";

/** A stored release, as the version dialog starts from it */
export interface EditableRelease {
  id: string;
  country: { id: string; label: string } | null;
  territoryLabel: string | null;
  format: FilmReleaseFormat;
  releaseDate: CatalogueDateInput | null;
  distributor: { id: string; label: string } | null;
  notes: string | null;
  sourceRecordId: string | null;
}

/** A stored version, as the edit dialog starts from it */
export interface EditableVersion {
  id: string;
  fingerprint: string;
  label: string | null;
  runtimeSeconds: number | null;
  notes: string | null;
  sourceRecordId: string | null;
  releases: EditableRelease[];
}

interface ReleaseDraft extends Omit<EditableRelease, "id" | "territoryLabel" | "notes"> {
  /** A key for the list while it is edited */
  key: string;
  id?: string;
  territoryLabel: string;
  notes: string;
}

let nextKey = 0;
function releaseDraft(release?: EditableRelease): ReleaseDraft {
  nextKey += 1;
  return {
    key: release?.id ?? `new-${nextKey}`,
    id: release?.id,
    country: release?.country ?? null,
    territoryLabel: release?.territoryLabel ?? "",
    format: release?.format ?? "theatrical",
    releaseDate: release?.releaseDate ?? null,
    distributor: release?.distributor ?? null,
    notes: release?.notes ?? "",
    sourceRecordId: release?.sourceRecordId ?? null,
  };
}

const FORMAT_OPTIONS = FILM_RELEASE_FORMATS.map((f) => ({
  value: f,
  label: FILM_RELEASE_FORMAT_LABELS[f],
}));

/**
 * Adds or edits a version of the film: a cut or edition (Theatrical,
 * Director's cut), its runtime when known, and the releases that brought it
 * to the public. A remake is not a version: it is a film of its own.
 */
export function VersionDialog({
  open,
  onClose,
  filmId,
  filmTitle,
  version,
  countries,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  filmId: string;
  filmTitle: string;
  version?: EditableVersion;
  countries: Choice[];
  sources: { id: string; label: string }[];
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={version ? "Edit version" : "Add version"}
      description={filmTitle}
      className="max-w-3xl"
    >
      {open && (
        <VersionForm
          filmId={filmId}
          version={version}
          countries={countries}
          sources={sources}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
}

function ReleaseFields({
  index,
  release,
  countries,
  onChange,
  onDateError,
  onRemove,
}: {
  index: number;
  release: ReleaseDraft;
  countries: Choice[];
  onChange: (release: ReleaseDraft) => void;
  onDateError: (error: string | null) => void;
  onRemove: () => void;
}) {
  const searchCountries = useListSearch(countries);
  const distributors = useOrganizationSearch("distribution_company");
  const label = `Release ${index + 1}`;
  return (
    <li className="space-y-3 rounded-sm border border-glass-border bg-bg-secondary/40 p-3">
      {/* The row carries the label's type: the button sits on its cap-height center */}
      <div className="type-label flex items-start justify-between gap-3">
        <p>{label}</p>
        <CapAligned height={24}>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            data-tooltip="Remove release"
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent-rose"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </CapAligned>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label="Format"
          value={release.format}
          onChange={(e) => onChange({ ...release, format: e.target.value as FilmReleaseFormat })}
          options={FORMAT_OPTIONS}
        />
        <Input
          label="Territory, when no country"
          value={release.territoryLabel}
          onChange={(e) => onChange({ ...release, territoryLabel: e.target.value })}
          placeholder="Cannes Film Festival, Europe"
          maxLength={200}
        />
      </div>
      <div className="space-y-2">
        <SingleChoiceField
          label="Country"
          value={release.country}
          onChange={(country) => onChange({ ...release, country })}
          search={searchCountries}
          placeholder="Search countries..."
        />
        <SingleChoiceField
          label="Distributor"
          value={release.distributor}
          onChange={(distributor) => onChange({ ...release, distributor })}
          search={distributors.search}
          onCreate={distributors.create}
          placeholder="Search distributors..."
        />
      </div>
      <CatalogueDateField
        label="Released"
        value={release.releaseDate}
        onChange={(releaseDate, err) => {
          onChange({ ...release, releaseDate });
          onDateError(err);
        }}
      />
      <Input
        label="Notes"
        value={release.notes}
        onChange={(e) => onChange({ ...release, notes: e.target.value })}
        placeholder="Premiere, limited release, restored print"
        maxLength={10000}
      />
    </li>
  );
}

function VersionForm({
  filmId,
  version,
  countries,
  sources,
  onDone,
}: {
  filmId: string;
  version?: EditableVersion;
  countries: Choice[];
  sources: { id: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(version?.label ?? "");
  const [runtime, setRuntime] = useState(runtimeText(version?.runtimeSeconds));
  const [notes, setNotes] = useState(version?.notes ?? "");
  const [sourceRecordId, setSourceRecordId] = useState(version?.sourceRecordId ?? null);
  const [releases, setReleases] = useState<ReleaseDraft[]>(
    () => version?.releases.map(releaseDraft) ?? [],
  );
  const [dateErrors, setDateErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seconds = parseRuntime(runtime);
  const runtimeError =
    seconds === null
      ? null
      : Number.isNaN(seconds)
        ? "Enter minutes (109) or hours and minutes (1h 49m)"
        : seconds < 1 || seconds > MAX_FILM_RUNTIME_SECONDS
          ? "Enter a runtime above 0 and up to 1,000 hours"
          : null;
  const blocked =
    !!runtimeError ||
    releases.some((r) => dateErrors[r.key]) ||
    saving;

  async function save() {
    if (blocked) return;
    setSaving(true);
    setError(null);
    const fields = {
      label: label.trim() || null,
      runtimeSeconds: seconds,
      notes: notes.trim() || null,
      sourceRecordId,
      releases: releases.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        countryId: r.country?.id ?? null,
        territoryLabel: r.territoryLabel.trim() || null,
        format: r.format,
        releaseDate: r.releaseDate,
        distributorId: r.distributor?.id ?? null,
        notes: r.notes.trim() || null,
        sourceRecordId: r.sourceRecordId,
      })),
    };
    try {
      if (version) await updateFilmVersion(version.id, fields, version.fingerprint);
      else await createFilmVersion({ workId: filmId, ...fields });
      toast.success(version ? "Version saved" : "Version added");
      onDone();
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the version";
      setError(message);
      toast.error(message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <Input
          label="Name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Theatrical, Director's cut (empty when unnamed)"
          maxLength={200}
        />
        <Input
          label={seconds && !runtimeError ? `Runtime: ${formatRuntime(seconds)}` : "Runtime"}
          value={runtime}
          onChange={(e) => setRuntime(e.target.value)}
          placeholder="109 or 1h 49m"
          inputMode="text"
          error={runtimeError ?? undefined}
        />
      </div>
      <Textarea
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        maxLength={10000}
        placeholder="What differs from the other versions"
      />
      {sources.length > 0 && (
        <div className="max-w-sm">
          <Select
            label="Source"
            value={sourceRecordId ?? ""}
            placeholder="No source"
            onChange={(e) => setSourceRecordId(e.target.value || null)}
            options={sources.map((s) => ({ value: s.id, label: s.label }))}
          />
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="type-group-title mb-3">Releases</legend>
        {releases.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            No releases recorded. A release is where and when this version
            reached the public: in cinemas, at a festival, on disc.
          </p>
        ) : (
          <ol className="space-y-3">
            {releases.map((release, index) => (
              <ReleaseFields
                key={release.key}
                index={index}
                release={release}
                countries={countries}
                onChange={(changed) =>
                  setReleases((list) => list.map((r) => (r.key === release.key ? changed : r)))
                }
                onDateError={(err) =>
                  setDateErrors((errors) => ({ ...errors, [release.key]: err }))
                }
                onRemove={() => {
                  setReleases((list) => list.filter((r) => r.key !== release.key));
                  setDateErrors((errors) => ({ ...errors, [release.key]: null }));
                }}
              />
            ))}
          </ol>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReleases((list) => [...list, releaseDraft()])}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          Add release
        </Button>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" data-shortcut="save" onClick={save} disabled={blocked}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {version ? "Save" : "Add version"}
        </Button>
      </div>
    </div>
  );
}
