"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { updateWork } from "@/lib/actions/works";
import { getWork } from "@/lib/actions/works";
import { getSeries } from "@/lib/actions/series";
import { getWorkTypes } from "@/lib/actions/taxonomy";
import { getRecommenders } from "@/lib/actions/recommenders";
import {
  EMPTY_WORK_FORM,
  WorkForm,
  workFormValues,
  workPayload,
} from "@/components/books/work-form";

interface WorkQuickEditDialogProps {
  open: boolean;
  onClose: () => void;
  workId: string;
}

export function WorkQuickEditDialog({
  open,
  onClose,
  workId,
}: WorkQuickEditDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reference data
  const [allSeries, setAllSeries] = useState<{ id: string; title: string }[]>(
    [],
  );
  const [allWorkTypes, setAllWorkTypes] = useState<
    { id: string; name: string }[]
  >([]);
  const [allRecommenders, setAllRecommenders] = useState<
    { id: string; name: string }[]
  >([]);
  const [values, setValues] = useState(EMPTY_WORK_FORM);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [work, seriesData, workTypesData, recommendersData] =
        await Promise.all([
          getWork(workId),
          getSeries(),
          getWorkTypes(),
          getRecommenders(),
        ]);

      if (!work) {
        toast.error("Work not found");
        onClose();
        return;
      }

      setAllSeries(seriesData.map((s) => ({ id: s.id, title: s.title })));
      setAllWorkTypes(
        workTypesData.map((wt) => ({ id: wt.id, name: wt.name })),
      );
      setAllRecommenders(
        recommendersData.map((r) => ({ id: r.id, name: r.name })),
      );
      setValues(
        workFormValues(
          work,
          work.workRecommenders?.map(
            (wr: { recommender: { id: string } }) => wr.recommender.id,
          ) ?? [],
          work.workAuthors.map((wa) => ({
            id: wa.author.id,
            name: wa.author.name,
            role: wa.role,
          })),
        ),
      );

      setLoaded(true);
    } catch {
      toast.error("Failed to load work data");
    } finally {
      setLoading(false);
    }
  }, [workId, onClose]);

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
    const payload = workPayload(values);
    if (!payload.ok) {
      toast.error(payload.error);
      return;
    }

    startTransition(async () => {
      try {
        await updateWork(workId, payload.input);
        toast.success("Work updated");
        onClose();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to update work",
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
      title="Edit Work"
    >
      {loading || !loaded ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <WorkForm
          idPrefix="quick-edit"
          values={values}
          onChange={setValues}
          workTypes={allWorkTypes}
          series={allSeries}
          recommenders={allRecommenders}
          seriesKey={`${open}-${workId}`}
          pending={isPending}
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
      )}
    </Dialog>
  );
}
