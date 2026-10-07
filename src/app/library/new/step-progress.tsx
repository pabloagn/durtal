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
}: {
  step: Step;
  /** While Fast Track saves, no step can be opened */
  disabled: boolean;
  onStep: (step: Step) => void;
}) {
  // "duplicate" is not in STEPS: it shows as the search step
  const currentIdx = step === "duplicate" ? 0 : STEPS.findIndex((s) => s.key === step);
  return (
    <div className="mb-6">
      {/* Six labels need about 600px: a narrow screen shows the current
          step and a bar, as the order dialog does */}
      <div className="sm:hidden">
        <p className="text-micro font-medium text-accent-rose-text">
          Step {currentIdx + 1} of {STEPS.length} — {STEPS[currentIdx].label}
        </p>
        <div className="mt-1 flex gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={s.label}
              disabled={i >= currentIdx || disabled}
              onClick={() => onStep(s.key)}
              className="flex-1 py-1.5"
            >
              <span
                className={`block h-0.5 rounded-full transition-colors duration-300 ${
                  i < currentIdx
                    ? "bg-accent-sage"
                    : i === currentIdx
                      ? "bg-accent-rose/60"
                      : "bg-bg-tertiary"
                }`}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {STEPS.map((s, i) => {
          const isCompleted = i < currentIdx;
          const isCurrent = i === currentIdx;
          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <div
                  className={`h-px w-4 ${isCompleted ? "bg-accent-sage" : "bg-bg-tertiary"}`}
                />
              )}
              <button
                type="button"
                disabled={!isCompleted || disabled}
                onClick={() => isCompleted && onStep(s.key)}
                className={`flex items-center gap-1 rounded-sm px-2 py-1 text-micro font-medium transition-colors ${
                  isCurrent
                    ? "bg-accent-plum text-accent-rose-text"
                    : isCompleted
                      ? "text-fg-secondary hover:text-fg-primary cursor-pointer"
                      : "text-fg-secondary cursor-default"
                }`}
              >
                {isCompleted && (
                  <Check className="h-2.5 w-2.5" strokeWidth={2} />
                )}
                {s.label}
              </button>
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
