"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gem } from "lucide-react";
import { toast } from "sonner";
import { localToday, type HuntAssessment } from "@/lib/constants/hunting";
import {
  huntAssessmentSchema,
  type HuntAssessmentInput,
} from "@/lib/validations/hunting";
import { updateHuntAssessment } from "@/lib/actions/hunting";
import { MARKS } from "@/lib/constants/marks";
import { MarkToggle } from "./mark-toggle";

/**
 * The rare mark on the book page. Marking dates it today; the date shows and
 * changes in the hover card.
 */
export function HuntAssessmentControl({
  workId,
  isRare = false,
  huntAssessedOn = null,
}: HuntAssessment & { workId: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState({ isRare, huntAssessedOn });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setSaved({ isRare, huntAssessedOn });
  }, [isRare, huntAssessedOn]);

  function save(input: HuntAssessmentInput) {
    const parsed = huntAssessmentSchema.safeParse(input);
    if (!parsed.success) {
      toast.error("Choose a valid date");
      return;
    }
    startTransition(async () => {
      try {
        setSaved(await updateHuntAssessment(workId, parsed.data));
        router.refresh();
      } catch {
        toast.error(
          `Could not update the ${MARKS.rare.label} mark. Try again.`,
        );
      }
    });
  }

  return (
    <MarkToggle
      mark={MARKS.rare}
      icon={Gem}
      tone="text-accent-gold"
      marked={saved.isRare}
      pending={pending}
      onToggle={() =>
        save(
          saved.isRare
            ? { isRare: false, huntAssessedOn: null }
            : { isRare: true, huntAssessedOn: localToday() },
        )
      }
      date={saved.huntAssessedOn}
      onDateChange={(date) => save({ isRare: true, huntAssessedOn: date })}
    />
  );
}
