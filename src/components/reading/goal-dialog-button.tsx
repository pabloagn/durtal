"use client";

import { Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";

/*
 * The one way to open the goal dialog (SLN-455): the hub, Settings, Reading
 * and later the stats page. The dialog loads only when opened.
 */

const LoadedGoalDialog = dynamic(() => import("./goal-dialog").then((m) => m.GoalDialog));

/**
 * Its own Suspense boundary while the dialog's code loads: otherwise the
 * nearest one on the page hides the page, the button that opened it
 * with it, and the focus falls to the body with no way back (SLN-1094)
 */
function GoalDialog({ onClose, editing }: { onClose: () => void; editing: boolean }) {
  return (
    <Suspense fallback={null}>
      <LoadedGoalDialog onClose={onClose} editing={editing} />
    </Suspense>
  );
}

/** `editing`: this year has a goal, so the button and the dialog say "Edit reading goals" (SLN-1096) */
export function GoalDialogButton({
  editing = false,
  label = editing ? "Edit reading goals" : "Set a reading goal",
  variant = "secondary",
  size = "md",
}: {
  editing?: boolean;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className="pointer-coarse:h-11" data-goal-open="">
        {label}
      </Button>
      {open && <GoalDialog onClose={() => setOpen(false)} editing={editing} />}
    </>
  );
}

/** The goal dialog opened from somewhere else, such as a menu */
export function LazyGoalDialog({ onClose, editing = false }: { onClose: () => void; editing?: boolean }) {
  return <GoalDialog onClose={onClose} editing={editing} />;
}
