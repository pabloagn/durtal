"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  AuthorForm,
  EMPTY_AUTHOR_FORM,
  authorFormValues,
  authorPayload,
} from "@/components/authors/author-form";
import { getAuthor, updateAuthor, getCountries } from "@/lib/actions/authors";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

interface AuthorEditDialogProps {
  open: boolean;
  onClose: () => void;
  authorId: string;
}

export function AuthorEditDialog({
  open,
  onClose,
  authorId,
}: AuthorEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [values, setValues] = useState(EMPTY_AUTHOR_FORM);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [author, countries] = await Promise.all([
        getAuthor(authorId),
        getCountries(),
      ]);

      if (!author) {
        toast.error("Person not found");
        onClose();
        return;
      }

      setCountryOptions([
        { value: "", label: "Not specified" },
        ...countries.map((c) => ({ value: c.id, label: c.name })),
      ]);
      setValues(authorFormValues(author));
      setLoaded(true);
    } catch {
      toast.error("Could not load the person");
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
    if (!values.name.trim()) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        await updateAuthor(authorId, authorPayload(values));
        toast.success("Person updated");
        onClose();
        router.refresh();
        triggerActivityRefresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not update the person",
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
      title="Edit person"
    >
      {loading || !loaded ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <AuthorForm
          mode="edit"
          values={values}
          onChange={setValues}
          countryOptions={countryOptions}
          pending={isPending}
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
      )}
    </Dialog>
  );
}
