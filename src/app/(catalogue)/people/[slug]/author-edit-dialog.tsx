"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  AuthorForm,
  EMPTY_AUTHOR_FORM,
  authorFormValues,
  authorPayload,
} from "@/components/authors/author-form";
import { getAuthor, getCountries, getPersonEditFingerprint } from "@/lib/actions/authors";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { updateAuthor } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

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
  const notices = toast.forAction(`edit-person:${authorId}`);
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [countryOptions, setCountryOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [values, setValues] = useState(EMPTY_AUTHOR_FORM);
  // Read before the person, so a save landing between the two reads makes
  // this one refused rather than let older values through (SLN-1244)
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [[basis, author], countries] = await Promise.all([
        getPersonEditFingerprint(authorId).then(
          async (fp) => [fp, await getAuthor(authorId)] as const,
        ),
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
      setFingerprint(basis);
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
      notices.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateAuthor(
          authorId,
          authorPayload(values),
          fingerprint ?? undefined,
        );
        notices.success("Person updated");
        onClose();
        // A new name gives the person a new address; the old one does not
        // redirect, so go to the new one
        if (result.slug) router.replace(`/people/${result.slug}`);
        else router.refresh();
        triggerActivityRefresh();
      } catch (err) {
        notices.error(
          refusalMessage(err, "Could not update the person"),
        );
      }
    });
  }

  return (
    <Dialog
      draft
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
