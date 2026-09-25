"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { HuntBadge } from "./hunt-badge";
import {
  HUNT_DIFFICULTIES,
  HUNT_LABELS,
  localToday,
  type HuntAssessment,
  type HuntDifficulty,
} from "@/lib/constants/hunting";
import { huntAssessmentSchema } from "@/lib/validations/hunting";
import { updateHuntAssessment } from "@/lib/actions/hunting";

export function HuntAssessmentControl({
  workId,
  ...assessment
}: HuntAssessment & { workId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [difficulty, setDifficulty] = useState<HuntDifficulty | "">("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function showEditor() {
    setDifficulty(assessment.huntDifficulty ?? "");
    setDate(assessment.huntAssessedOn ?? localToday());
    setError("");
    setOpen(true);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = huntAssessmentSchema.safeParse(
      difficulty
        ? { huntDifficulty: difficulty, huntAssessedOn: date }
        : { huntDifficulty: null, huntAssessedOn: null },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the assessment date");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await updateHuntAssessment(workId, parsed.data);
        toast.success(
          difficulty
            ? "Hunting assessment saved"
            : "Hunting assessment cleared",
        );
        setOpen(false);
        router.refresh();
      } catch {
        setError("Could not save the assessment. Please try again.");
      }
    });
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <HuntBadge {...assessment} />
        <Button variant="ghost" size="sm" onClick={showEditor}>
          <Crosshair className="h-3.5 w-3.5" strokeWidth={1.5} />
          {assessment.huntDifficulty
            ? "Edit hunting assessment"
            : "Mark rarity / hunting difficulty"}
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Hunting assessment"
        description="Record how hard this book is to find and when you checked."
        className="max-w-md"
        expandable={false}
      >
        <form onSubmit={save} className="space-y-4">
          <Select
            id="hunt-difficulty"
            label="Availability"
            value={difficulty}
            disabled={pending}
            options={[
              { value: "", label: "Not marked" },
              ...HUNT_DIFFICULTIES.map((value) => ({
                value,
                label: HUNT_LABELS[value],
              })),
            ]}
            onChange={(e) =>
              setDifficulty(e.target.value as HuntDifficulty | "")
            }
          />
          {difficulty && (
            <>
              <fieldset disabled={pending}>
                <DatePicker
                  id="hunt-assessed-on"
                  label="Assessed on"
                  required
                  value={date}
                  onChange={setDate}
                />
              </fieldset>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setDate(localToday())}
              >
                Checked again today
              </Button>
              <p className="text-xs text-fg-muted">
                Availability changes. Keep this date current when you check
                again.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-accent-red">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save assessment"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
