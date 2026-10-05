"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SectionHeading } from "@/components/shared/section-heading";
import { getGoalDialogData, removeReadingGoal, setReadingGoal } from "@/lib/actions/reading-goals";
import { GOAL_METRICS, type GoalMetric } from "@/lib/reading/constants";
import { pastGoalText } from "@/lib/reading/goals";
import { DialogFooter } from "./dialogs/fields";

type Data = Awaited<ReturnType<typeof getGoalDialogData>>;

const LABELS: Record<GoalMetric, string> = { books: "Books", pages: "Pages", hours: "Hours" };

/** A year's goals as the form holds them */
function formOf(data: Data, year: number) {
  const goals = data.goals.filter((g) => g.year === year);
  const first = goals[0];
  return {
    targets: Object.fromEntries(GOAL_METRICS.map((m) => [m, String(goals.find((g) => g.metric === m)?.target ?? "")])) as Record<GoalMetric, string>,
    countRereads: first?.countRereads ?? true,
    excluded: new Set(first?.excludedWorkTypeIds ?? []),
  };
}

/**
 * Set, change or remove a year's reading goals (SLN-455): books, pages or
 * hours, each optional; whether re-reads count; the work types left out.
 * Then the past years, plainly. Changing a goal mid-year needs no comment.
 */
export function GoalDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const rereadsId = useId();
  const [data, setData] = useState<Data | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [form, setForm] = useState<ReturnType<typeof formOf> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getGoalDialogData()
      .then((d) => {
        if (!live) return;
        setData(d);
        setYear(d.year);
        setForm(formOf(d, d.year));
      })
      .catch(() => toast.error("Could not load your goals. Try again."));
    return () => {
      live = false;
    };
  }, []);

  function pickYear(next: number) {
    if (!data) return;
    setYear(next);
    setForm(formOf(data, next));
  }

  const errors = form
    ? Object.fromEntries(
        GOAL_METRICS.map((m) => {
          const v = form.targets[m].trim();
          const n = Number(v);
          return [m, v && (!Number.isInteger(n) || n < 1 || n > 100_000) ? "A whole number from 1 to 100,000" : null];
        }),
      )
    : {};

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !form || year === null || Object.values(errors).some(Boolean)) return;
    setSaving(true);
    try {
      for (const metric of GOAL_METRICS) {
        const value = form.targets[metric].trim();
        const had = data.goals.some((g) => g.year === year && g.metric === metric);
        if (value)
          await setReadingGoal({ year, metric, target: Number(value), countRereads: form.countRereads, excludedWorkTypeIds: [...form.excluded] });
        else if (had) await removeReadingGoal({ year, metric });
      }
      toast.success("Goals saved");
      onClose();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the goals");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Set a reading goal" description="Optional. Leave a field empty for no goal." className="max-w-lg" expandable={false}>
      {!data || !form || year === null ? (
        <div className="h-64" aria-busy="true" />
      ) : (
        <form onSubmit={save} className="space-y-5" data-goal-dialog="">
          <SegmentedControl
            options={[
              { value: String(data.year), label: String(data.year) },
              { value: String(data.year + 1), label: String(data.year + 1) },
            ]}
            value={String(year)}
            onChange={(v) => pickYear(Number(v))}
            ariaLabel="Year"
          />
          <div className="grid grid-cols-3 gap-3">
            {GOAL_METRICS.map((m) => (
              <Input
                key={m}
                label={LABELS[m]}
                inputMode="numeric"
                value={form.targets[m]}
                onChange={(e) => setForm({ ...form, targets: { ...form.targets, [m]: e.target.value } })}
                error={errors[m] ?? undefined}
                className="pointer-coarse:h-11 pointer-coarse:text-base"
                data-goal-target={m}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch id={rereadsId} checked={form.countRereads} onCheckedChange={(v) => setForm({ ...form, countRereads: v })} />
            <label htmlFor={rereadsId} className="flex cursor-pointer items-center text-sm text-fg-secondary pointer-coarse:min-h-11">
              Count re-reads
            </label>
          </div>
          {data.workTypes.length > 0 && (
            <fieldset>
              <legend className="type-label mb-1.5">Leave out</legend>
              <div className="max-h-40 overflow-y-auto rounded-sm border border-glass-border px-3 py-2" data-goal-types="">
                {data.workTypes.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-1 text-sm text-fg-secondary pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      checked={form.excluded.has(t.id)}
                      onChange={(e) => {
                        const next = new Set(form.excluded);
                        if (e.target.checked) next.add(t.id);
                        else next.delete(t.id);
                        setForm({ ...form, excluded: next });
                      }}
                      className="h-3.5 w-3.5 accent-accent-rose"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {data.history.length > 0 && (
            <section data-goal-history="">
              <SectionHeading as="h3" title="Past years" />
              <ul className="space-y-1 text-sm text-fg-secondary">
                {data.history.map((h) => (
                  <li key={`${h.year}-${h.metric}`}>{pastGoalText(h)}</li>
                ))}
              </ul>
            </section>
          )}
          <DialogFooter onCancel={onClose} saving={saving} disabled={Object.values(errors).some(Boolean)} />
        </form>
      )}
    </Dialog>
  );
}
