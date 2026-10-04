"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  AuthorForm,
  EMPTY_AUTHOR_FORM,
  authorPayload,
} from "@/components/authors/author-form";
import { createAuthor, getCountries } from "@/lib/actions/authors";

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
  const [values, setValues] = useState(EMPTY_AUTHOR_FORM);

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

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    setValues(EMPTY_AUTHOR_FORM);
  }

  function handleSubmit() {
    if (!values.name.trim()) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        const author = await createAuthor(authorPayload(values));
        toast.success(`"${author.name}" added`, {
          action: author.slug
            ? {
                label: "Open",
                onClick: () => router.push(`/people/${author.slug}`),
              }
            : undefined,
        });
        setOpen(false);
        setValues(EMPTY_AUTHOR_FORM);
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
          Add Person
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
          <AuthorForm
            mode="create"
            values={values}
            onChange={setValues}
            countryOptions={countryOptions}
            pending={isPending}
            onCancel={handleClose}
            onSubmit={handleSubmit}
          />
        )}
      </Dialog>
    </>
  );
}
