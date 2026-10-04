"use client";

import type { Dispatch, SetStateAction } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthorNameInput } from "@/components/shared/author-name-input";
import { Select } from "@/components/ui/select";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { PlacePicker, type PlaceValue } from "@/components/shared/place-picker";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

/** The author dialogs' fields, as the inputs hold them (text for numbers) */
export interface AuthorFormValues {
  name: string;
  sortName: string;
  firstName: string;
  lastName: string;
  realName: string;
  gender: string;
  nationalityId: string;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  birthYearIsApproximate: boolean;
  deathYear: string;
  deathMonth: string;
  deathDay: string;
  deathYearIsApproximate: boolean;
  birthPlace: PlaceValue | null;
  deathPlace: PlaceValue | null;
  bio: string;
  website: string;
  openLibraryKey: string;
  goodreadsId: string;
}

export const EMPTY_AUTHOR_FORM: AuthorFormValues = {
  name: "",
  sortName: "",
  firstName: "",
  lastName: "",
  realName: "",
  gender: "",
  nationalityId: "",
  birthYear: "",
  birthMonth: "",
  birthDay: "",
  birthYearIsApproximate: false,
  deathYear: "",
  deathMonth: "",
  deathDay: "",
  deathYearIsApproximate: false,
  birthPlace: null,
  deathPlace: null,
  bio: "",
  website: "",
  openLibraryKey: "",
  goodreadsId: "",
};

const text = (value: string | null | undefined) => value ?? "";
const number = (value: number | null | undefined) => (value != null ? String(value) : "");

/** A stored author as the form's values */
export function authorFormValues(author: {
  name: string;
  sortName: string | null;
  firstName: string | null;
  lastName: string | null;
  realName: string | null;
  gender: string | null;
  nationalityId: string | null;
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  birthYearIsApproximate: boolean | null;
  deathYear: number | null;
  deathMonth: number | null;
  deathDay: number | null;
  deathYearIsApproximate: boolean | null;
  birthPlace?: PlaceValue | null;
  deathPlace?: PlaceValue | null;
  bio: string | null;
  website: string | null;
  openLibraryKey: string | null;
  goodreadsId: string | null;
}): AuthorFormValues {
  return {
    name: author.name,
    sortName: text(author.sortName),
    firstName: text(author.firstName),
    lastName: text(author.lastName),
    realName: text(author.realName),
    gender: text(author.gender),
    nationalityId: text(author.nationalityId),
    birthYear: number(author.birthYear),
    birthMonth: number(author.birthMonth),
    birthDay: number(author.birthDay),
    birthYearIsApproximate: author.birthYearIsApproximate ?? false,
    deathYear: number(author.deathYear),
    deathMonth: number(author.deathMonth),
    deathDay: number(author.deathDay),
    deathYearIsApproximate: author.deathYearIsApproximate ?? false,
    birthPlace: author.birthPlace ?? null,
    deathPlace: author.deathPlace ?? null,
    bio: text(author.bio),
    website: text(author.website),
    openLibraryKey: text(author.openLibraryKey),
    goodreadsId: text(author.goodreadsId),
  };
}

const optionalText = (value: string) => value.trim() || null;
const optionalNumber = (value: string) => (value ? parseInt(value, 10) : null);

/** The form's values as createAuthor and updateAuthor take them */
export function authorPayload(v: AuthorFormValues) {
  return {
    name: v.name.trim(),
    sortName: optionalText(v.sortName),
    firstName: optionalText(v.firstName),
    lastName: optionalText(v.lastName),
    realName: optionalText(v.realName),
    gender: (v.gender as "male" | "female") || null,
    nationalityId: v.nationalityId || null,
    birthYear: optionalNumber(v.birthYear),
    birthMonth: optionalNumber(v.birthMonth),
    birthDay: optionalNumber(v.birthDay),
    birthYearIsApproximate: v.birthYearIsApproximate,
    deathYear: optionalNumber(v.deathYear),
    deathMonth: optionalNumber(v.deathMonth),
    deathDay: optionalNumber(v.deathDay),
    deathYearIsApproximate: v.deathYearIsApproximate,
    birthPlaceId: v.birthPlace?.id ?? null,
    deathPlaceId: v.deathPlace?.id ?? null,
    bio: optionalText(v.bio),
    website: optionalText(v.website),
    openLibraryKey: optionalText(v.openLibraryKey),
    goodreadsId: optionalText(v.goodreadsId),
  };
}

/** A year, month and day trio of number fields */
function DateFields({
  prefix,
  values,
  set,
}: {
  prefix: "birth" | "death";
  values: AuthorFormValues;
  set: <K extends keyof AuthorFormValues>(key: K, value: AuthorFormValues[K]) => void;
}) {
  const word = prefix === "birth" ? "Birth" : "Death";
  const year = `${prefix}Year` as const;
  const month = `${prefix}Month` as const;
  const day = `${prefix}Day` as const;
  const approximate = `${prefix}YearIsApproximate` as const;
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Input
          label={`${word} Year`}
          type="number"
          min={-3000}
          max={2100}
          value={values[year]}
          onChange={(e) => set(year, e.target.value)}
        />
        <Input
          label={`${word} Month`}
          type="number"
          min={1}
          max={12}
          value={values[month]}
          onChange={(e) => set(month, e.target.value)}
        />
        <Input
          label={`${word} Day`}
          type="number"
          min={1}
          max={31}
          value={values[day]}
          onChange={(e) => set(day, e.target.value)}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
        <input
          type="checkbox"
          checked={values[approximate]}
          onChange={(e) => set(approximate, e.target.checked)}
          className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
        />
        {word} year is approximate
      </label>
    </>
  );
}

/**
 * The author dialogs' body and footer. Creating, the name field offers to
 * fill the sort, first and last names (only those still empty) and takes the
 * focus; editing, it is a plain field.
 */
export function AuthorForm({
  mode,
  values,
  onChange,
  countryOptions,
  pending,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  values: AuthorFormValues;
  /** A state setter: updates compose, so two changes in one event both land */
  onChange: Dispatch<SetStateAction<AuthorFormValues>>;
  countryOptions: { value: string; label: string }[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof AuthorFormValues>(key: K, value: AuthorFormValues[K]) =>
    onChange((current) => ({ ...current, [key]: value }));
  return (
    <>
      <div className="max-h-[75vh] overflow-y-auto pr-1">
        <div className="space-y-6">
          {/* Identity */}
          <section>
            <h3 className="type-group-title mb-3">
              Identity
            </h3>
            <div className="space-y-3">
              {mode === "create" ? (
                <AuthorNameInput
                  label="Name"
                  value={values.name}
                  onValueChange={(name) => set("name", name)}
                  onNameOrder={(parts) =>
                    // Fill only what is still empty
                    onChange((current) => ({
                      ...current,
                      sortName: current.sortName.trim() ? current.sortName : parts.sortName,
                      firstName: current.firstName.trim() ? current.firstName : parts.first,
                      lastName: current.lastName.trim() ? current.lastName : parts.last,
                    }))
                  }
                  required
                  autoFocus
                />
              ) : (
                <Input
                  label="Name"
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  required
                />
              )}
              <Input
                label="Sort Name"
                value={values.sortName}
                onChange={(e) => set("sortName", e.target.value)}
                placeholder={mode === "create" ? "Last, First (auto-generated if empty)" : "Last, First"}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="First Name"
                  value={values.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                />
                <Input
                  label="Last Name"
                  value={values.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </div>
              <Input
                label="Real Name"
                value={values.realName}
                onChange={(e) => set("realName", e.target.value)}
                placeholder="If different from pen name"
              />
            </div>
          </section>

          {/* Demographics */}
          <section>
            <h3 className="type-group-title mb-3">
              Demographics
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Gender"
                options={GENDER_OPTIONS}
                value={values.gender}
                onChange={(e) => set("gender", e.target.value)}
              />
              <Select
                label="Nationality"
                options={countryOptions}
                value={values.nationalityId}
                onChange={(e) => set("nationalityId", e.target.value)}
              />
            </div>
          </section>

          {/* Life dates */}
          <section>
            <h3 className="type-group-title mb-3">
              Life Dates
            </h3>
            <div className="space-y-3">
              <DateFields prefix="birth" values={values} set={set} />
              <DateFields prefix="death" values={values} set={set} />
            </div>
          </section>

          {/* Places */}
          <section>
            <h3 className="type-group-title mb-3">
              Places
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <PlacePicker
                label="Birth Place"
                value={values.birthPlace}
                onChange={(place) => set("birthPlace", place)}
                disabled={pending}
              />
              <PlacePicker
                label="Death Place"
                value={values.deathPlace}
                onChange={(place) => set("deathPlace", place)}
                disabled={pending}
              />
            </div>
          </section>

          {/* Bio */}
          <section>
            <h3 className="type-group-title mb-3">
              Bio
            </h3>
            <RichTextEditor
              label="Biography"
              value={values.bio}
              onChange={(bio) => set("bio", bio)}
              rows={6}
              placeholder="Author biography"
              disabled={pending}
            />
          </section>

          {/* Links */}
          <section>
            <h3 className="type-group-title mb-3">
              Links
            </h3>
            <div className="space-y-3">
              <Input
                label="Website"
                type="url"
                value={values.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://..."
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Open Library Key"
                  value={values.openLibraryKey}
                  onChange={(e) => set("openLibraryKey", e.target.value)}
                  placeholder="/authors/OL..."
                />
                <Input
                  label="Goodreads ID"
                  value={values.goodreadsId}
                  onChange={(e) => set("goodreadsId", e.target.value)}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-glass-border pt-4">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={pending || !values.name.trim()}
        >
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              {mode === "create" ? "Creating" : "Saving"}
            </>
          ) : mode === "create" ? (
            "Create Author"
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>
    </>
  );
}
