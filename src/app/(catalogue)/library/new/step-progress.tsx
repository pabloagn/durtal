"use client";

import type { ReactNode } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STEPS, type Step } from "./wizard-model";

/** The steps so far: a done step can be opened again */
export function StepProgress({
  step,
  disabled,
  onStep,
  duplicateAfter,
}: {
  step: Step;
  /** While Fast Track saves, no step can be opened */
  disabled: boolean;
  onStep: (step: Step) => void;
  duplicateAfter?: "search" | "details" | null;
}) {
  const steps = [...STEPS];
  if (duplicateAfter) steps.splice(steps.findIndex(s => s.key === duplicateAfter) + 1, 0, { key: "duplicate", label: "Existing book" });
  const currentIdx = Math.max(0, steps.findIndex(s => s.key === step));
  return (
    <div className="mb-6">
      {/* Six labels need about 600px: a narrow screen shows the current
          step and a bar, as the order dialog does */}
      <div className="sm:hidden">
        <p className="text-micro font-medium text-accent-primary">
          Step {currentIdx + 1} of {steps.length} — {steps[currentIdx].label}
        </p>
        <div className="mt-1 flex gap-1.5">
          {steps.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={s.label}
              disabled={i >= currentIdx || disabled}
              onClick={() => onStep(s.key)}
              // On touch a 44px target, with negative margins so the row keeps its height
              className="flex-1 py-1.5 pointer-coarse:-my-[15px] pointer-coarse:py-[21px]"
            >
              <span
                className={`block h-0.5 rounded-full transition-colors duration-300 ${
                  i < currentIdx
                    ? "bg-accent-sage"
                    : i === currentIdx
                      ? "bg-accent-primary/60"
                      : "bg-bg-tertiary"
                }`}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {steps.map((s, i) => {
          const isCompleted = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <div
                  className={`h-px w-4 ${isCompleted ? "bg-accent-sage" : "bg-bg-tertiary"}`}
                />
              )}
              {isCompleted ? (
                // A done step opens again: its label is a text command
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onStep(s.key)}
                  className="flex items-center gap-1 rounded-sm px-2 py-1 cursor-pointer text-micro font-medium text-fg-secondary disabled:cursor-default"
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={1.5} aria-hidden />
                  <span className={disabled ? undefined : "text-command"}>{s.label}</span>
                </button>
              ) : (
                // The step in view and the steps ahead are states, not commands
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={`flex items-center gap-1 rounded-sm px-2 py-1 text-micro font-medium ${
                    isCurrent ? "bg-selection-bg text-accent-primary" : "text-fg-secondary"
                  }`}
                >
                  {s.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A step's actions: Back, Cancel, and the step's own on the right. `cancel`
 * takes `mr-auto`, which keeps it beside Back when the row wraps.
 */
export function StepFooter({
  onBack,
  cancel,
  children,
}: {
  onBack: () => void;
  cancel: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        Back
      </Button>
      {cancel}
      <div className="ml-auto flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}
