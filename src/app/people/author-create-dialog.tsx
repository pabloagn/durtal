"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthorNameInput } from "@/components/shared/author-name-input";
import { Select } from "@/components/ui/select";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { PlacePicker, type PlaceValue } from "@/components/shared/place-picker";
import { createAuthor, getCountries } from "@/lib/actions/authors";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

/**
 * Add Author. With `open` and `onOpenChange` the caller controls it (the
 * global "A" shortcut); otherwise it shows its own "Add person" button.
 */
export function AuthorCreateDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) =>
    controlled ? onOpenChange?.(next) : setOwnOpen(next);
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [countriesLoaded, setCountriesLoaded] = useState(false);

  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);

  // Form state
  const [name, setName] = useState("");
  const [sortName, setSortName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [realName, setRealName] = useState("");
  const [gender, setGender] = useState("");
  const [nationalityId, setNationalityId] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYearIsApproximate, setBirthYearIsApproximate] = useState(false);
  const [deathYear, setDeathYear] = useState("");
  const [deathMonth, setDeathMonth] = useState("");
  const [deathDay, setDeathDay] = useState("");
  const [deathYearIsApproximate, setDeathYearIsApproximate] = useState(false);
  const [birthPlace, setBirthPlace] = useState<PlaceValue | null>(null);
  const [deathPlace, setDeathPlace] = useState<PlaceValue | null>(null);
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [openLibraryKey, setOpenLibraryKey] = useState("");
  const [goodreadsId, setGoodreadsId] = useState("");

  useEffect(() => {
    if (open && !countriesLoaded) {
      setLoading(true);
      getCountries()
        .then((countries) => {
          setCountryOptions([
            { value: "", label: "Not specified" },
            ...countries.map((c) => ({ value: c.id, label: c.name })),
          ]);
          setCountriesLoaded(true);
        })
        .catch(() => toast.error("Failed to load countries"))
        .finally(() => setLoading(false));
    }
  }, [open, countriesLoaded]);

  function resetForm() {
    setName("");
    setSortName("");
    setFirstName("");
    setLastName("");
    setRealName("");
    setGender("");
    setNationalityId("");
    setBirthYear("");
    setBirthMonth("");
    setBirthDay("");
    setBirthYearIsApproximate(false);
    setDeathYear("");
    setDeathMonth("");
    setDeathDay("");
    setDeathYearIsApproximate(false);
    setBirthPlace(null);
    setDeathPlace(null);
    setBio("");
    setWebsite("");
    setOpenLibraryKey("");
    setGoodreadsId("");
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    resetForm();
  }

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        const author = await createAuthor({
          name: name.trim(),
          sortName: sortName.trim() || null,
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          realName: realName.trim() || null,
          gender: (gender as "male" | "female") || null,
          nationalityId: nationalityId || null,
          birthYear: birthYear ? parseInt(birthYear, 10) : null,
          birthMonth: birthMonth ? parseInt(birthMonth, 10) : null,
          birthDay: birthDay ? parseInt(birthDay, 10) : null,
          birthYearIsApproximate,
          deathYear: deathYear ? parseInt(deathYear, 10) : null,
          deathMonth: deathMonth ? parseInt(deathMonth, 10) : null,
          deathDay: deathDay ? parseInt(deathDay, 10) : null,
          deathYearIsApproximate,
          birthPlaceId: birthPlace?.id ?? null,
          deathPlaceId: deathPlace?.id ?? null,
          bio: bio.trim() || null,
          website: website.trim() || null,
          openLibraryKey: openLibraryKey.trim() || null,
          goodreadsId: goodreadsId.trim() || null,
        });
        toast.success(`"${author.name}" added`, {
          action: author.slug
            ? {
                label: "Open",
                onClick: () => router.push(`/people/${author.slug}`),
              }
            : undefined,
        });
        setOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not add the person",
        );
      }
    });
  }

  return (
    <>
      {!controlled && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          type="button"
          data-tooltip="Add person"
          data-tooltip-keys="a then a"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add Author
        </Button>
      )}

      <Dialog
        open={open}
        onClose={handleClose}
        title="Add person"
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <>
            <div className="max-h-[75vh] overflow-y-auto pr-1">
              <div className="space-y-6">
                {/* Identity */}
                <section>
                  <h3 className="type-group-title mb-3">
                    Identity
                  </h3>
                  <div className="space-y-3">
                    <AuthorNameInput
                      label="Name"
                      value={name}
                      onValueChange={setName}
                      onNameOrder={(parts) => {
                        // Fill only what is still empty
                        if (!sortName.trim()) setSortName(parts.sortName);
                        if (!firstName.trim()) setFirstName(parts.first);
                        if (!lastName.trim()) setLastName(parts.last);
                      }}
                      required
                      autoFocus
                    />
                    <Input
                      label="Sort Name"
                      value={sortName}
                      onChange={(e) => setSortName(e.target.value)}
                      placeholder="Last, First (auto-generated if empty)"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="First Name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                      <Input
                        label="Last Name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                    <Input
                      label="Real Name"
                      value={realName}
                      onChange={(e) => setRealName(e.target.value)}
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
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                    />
                    <Select
                      label="Nationality"
                      options={countryOptions}
                      value={nationalityId}
                      onChange={(e) => setNationalityId(e.target.value)}
                    />
                  </div>
                </section>

                {/* Life dates */}
                <section>
                  <h3 className="type-group-title mb-3">
                    Life Dates
                  </h3>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        label="Birth Year"
                        type="number"
                        min={-3000}
                        max={2100}
                        value={birthYear}
                        onChange={(e) => setBirthYear(e.target.value)}
                      />
                      <Input
                        label="Birth Month"
                        type="number"
                        min={1}
                        max={12}
                        value={birthMonth}
                        onChange={(e) => setBirthMonth(e.target.value)}
                      />
                      <Input
                        label="Birth Day"
                        type="number"
                        min={1}
                        max={31}
                        value={birthDay}
                        onChange={(e) => setBirthDay(e.target.value)}
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={birthYearIsApproximate}
                        onChange={(e) =>
                          setBirthYearIsApproximate(e.target.checked)
                        }
                        className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
                      />
                      Birth year is approximate
                    </label>

                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        label="Death Year"
                        type="number"
                        min={-3000}
                        max={2100}
                        value={deathYear}
                        onChange={(e) => setDeathYear(e.target.value)}
                      />
                      <Input
                        label="Death Month"
                        type="number"
                        min={1}
                        max={12}
                        value={deathMonth}
                        onChange={(e) => setDeathMonth(e.target.value)}
                      />
                      <Input
                        label="Death Day"
                        type="number"
                        min={1}
                        max={31}
                        value={deathDay}
                        onChange={(e) => setDeathDay(e.target.value)}
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-secondary">
                      <input
                        type="checkbox"
                        checked={deathYearIsApproximate}
                        onChange={(e) =>
                          setDeathYearIsApproximate(e.target.checked)
                        }
                        className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
                      />
                      Death year is approximate
                    </label>
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
                      value={birthPlace}
                      onChange={setBirthPlace}
                      disabled={isPending}
                    />
                    <PlacePicker
                      label="Death Place"
                      value={deathPlace}
                      onChange={setDeathPlace}
                      disabled={isPending}
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
                    value={bio}
                    onChange={setBio}
                    rows={6}
                    placeholder="Biography"
                    disabled={isPending}
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
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://..."
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        label="Open Library Key"
                        value={openLibraryKey}
                        onChange={(e) => setOpenLibraryKey(e.target.value)}
                        placeholder="/authors/OL..."
                      />
                      <Input
                        label="Goodreads ID"
                        value={goodreadsId}
                        onChange={(e) => setGoodreadsId(e.target.value)}
                      />
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-glass-border pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClose}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={isPending || !name.trim()}
              >
                {isPending ? (
                  <>
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={1.5}
                    />
                    Creating
                  </>
                ) : (
                  "Add person"
                )}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}
