"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Gem } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { localToday, type HuntAssessment } from "@/lib/constants/hunting";
import {
  huntAssessmentSchema,
  type HuntAssessmentInput,
} from "@/lib/validations/hunting";
import { MARKS } from "@/lib/constants/marks";
import { MarkToggle } from "./mark-toggle";
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
  const [pending, setPending] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    setSaved({ isRare, huntAssessedOn });
  }, [isRare, huntAssessedOn]);

  function save(input: HuntAssessmentInput) {
    if (saving.current) return;
    const parsed = huntAssessmentSchema.safeParse(input);
    if (!parsed.success) {
      toast.error("Choose a valid date");
      return;
    }
    saving.current = true;
    setPending(true);
    void (async () => {
      try {
        setSaved(await updateHuntAssessment(workId, parsed.data));
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, `Could not update the ${MARKS.rare.label} mark. Try again.`));
      } finally {
        saving.current = false;
        setPending(false);
      }
    })();
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
