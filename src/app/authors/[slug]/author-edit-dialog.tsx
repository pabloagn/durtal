"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RichTextEditor } from "@/components/shared/rich-text-editor";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getAuthor, updateAuthor, getCountries } from "@/lib/actions/authors";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

interface AuthorEditDialogProps {
  open: boolean;
  onClose: () => void;
  authorId: string;
}

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

export function AuthorEditDialog({
  open,
  onClose,
  authorId,
}: AuthorEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reference data
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
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [openLibraryKey, setOpenLibraryKey] = useState("");
  const [goodreadsId, setGoodreadsId] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [author, countries] = await Promise.all([
        getAuthor(authorId),
        getCountries(),
      ]);

      if (!author) {
        toast.error("Author not found");
        onClose();
        return;
      }

      setCountryOptions([
        { value: "", label: "Not specified" },
        ...countries.map((c) => ({ value: c.id, label: c.name })),
      ]);

      // Populate form
      setName(author.name);
      setSortName(author.sortName ?? "");
      setFirstName(author.firstName ?? "");
      setLastName(author.lastName ?? "");
      setRealName(author.realName ?? "");
      setGender(author.gender ?? "");
      setNationalityId(author.nationalityId ?? "");
      setBirthYear(author.birthYear != null ? String(author.birthYear) : "");
      setBirthMonth(
        author.birthMonth != null ? String(author.birthMonth) : "",
      );
      setBirthDay(author.birthDay != null ? String(author.birthDay) : "");
      setBirthYearIsApproximate(author.birthYearIsApproximate ?? false);
      setDeathYear(author.deathYear != null ? String(author.deathYear) : "");
      setDeathMonth(
        author.deathMonth != null ? String(author.deathMonth) : "",
      );
      setDeathDay(author.deathDay != null ? String(author.deathDay) : "");
      setDeathYearIsApproximate(author.deathYearIsApproximate ?? false);
      setBio(author.bio ?? "");
      setWebsite(author.website ?? "");
      setOpenLibraryKey(author.openLibraryKey ?? "");
      setGoodreadsId(author.goodreadsId ?? "");

      setLoaded(true);
    } catch {
      toast.error("Failed to load author data");
    } finally {
      setLoading(false);
    }
  }, [authorId, onClose]);

  useEffect(() => {
    if (open && !loaded) {
      fetchData();
    }
  }, [open, loaded, fetchData]);

  useEffect(() => {
    if (!open) {
      setLoaded(false);
    }
  }, [open]);

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        await updateAuthor(authorId, {
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
          bio: bio.trim() || null,
          website: website.trim() || null,
          openLibraryKey: openLibraryKey.trim() || null,
          goodreadsId: goodreadsId.trim() || null,
        });
        toast.success("Author updated");
        onClose();
        router.refresh();
        triggerActivityRefresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update author",
        );
      }
    });
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isPending) onClose();
      }}
      title="Edit Author"
    >
      {loading || !loaded ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <div className="space-y-6">
              {/* Identity */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Identity
                </h3>
                <div className="space-y-3">
                  <Input
                    label="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <Input
                    label="Sort Name"
                    value={sortName}
                    onChange={(e) => setSortName(e.target.value)}
                    placeholder="Last, First"
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
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
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
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
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

              {/* Bio */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                  Bio
                </h3>
                <RichTextEditor
                  label="Biography"
                  value={bio}
                  onChange={setBio}
                  rows={6}
                  placeholder="Author biography"
                  disabled={isPending}
                />
              </section>

              {/* Links */}
              <section>
                <h3 className="mb-3 font-serif text-lg text-fg-secondary">
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
              onClick={onClose}
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
                  Saving
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
