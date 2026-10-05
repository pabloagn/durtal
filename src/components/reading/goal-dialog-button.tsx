"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";

/*
 * The one way to open the goal dialog (SLN-455): the hub, Settings, Reading
 * and later the stats page. The dialog loads only when opened.
 */

const GoalDialog = dynamic(() => import("./goal-dialog").then((m) => m.GoalDialog));

export function GoalDialogButton({
  label = "Set a reading goal",
  variant = "secondary",
  size = "md",
}: {
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
      {open && <GoalDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** The goal dialog opened from somewhere else, such as a menu */
export function LazyGoalDialog({ onClose }: { onClose: () => void }) {
  return <GoalDialog onClose={onClose} />;
}
