"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gem } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { localToday, type HuntAssessment } from "@/lib/constants/hunting";
import {
  huntAssessmentSchema,
  type HuntAssessmentInput,
} from "@/lib/validations/hunting";
import { MARKS } from "@/lib/constants/marks";
import { MarkToggle, confirmMarkOnTouch } from "./mark-toggle";
import { updateHuntAssessment } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

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

  /** `toggled`: from the icon, which says what it did on touch */
  function save(input: HuntAssessmentInput, toggled = false) {
    const parsed = huntAssessmentSchema.safeParse(input);
    if (!parsed.success) {
      toast.error("Choose a valid date");
      return;
    }
    startTransition(async () => {
      try {
        const next = await updateHuntAssessment(workId, parsed.data);
        setSaved(next);
        if (toggled) confirmMarkOnTouch(MARKS.rare, next.isRare);
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, `Could not update the ${MARKS.rare.label} mark. Try again.`));
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
          true,
        )
      }
      date={saved.huntAssessedOn}
      onDateChange={(date) => save({ isRare: true, huntAssessedOn: date })}
    />
  );
}
