"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Skull } from "lucide-react";
import { toast } from "sonner";
import { setPoison } from "@/lib/actions/poison";
import {
  POISON_HINT,
  POISON_LABEL,
  POISON_MARK,
  POISON_UNMARK,
} from "@/lib/constants/poison";

/** One-click skull toggle beside the rare gem on the book page. */
export function PoisonToggle({
  workId,
  isPoison = false,
}: {
  workId: string;
  isPoison?: boolean;
}) {
  const router = useRouter();
  const [marked, setMarked] = useState(isPoison);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setMarked(isPoison);
  }, [isPoison]);

  function toggle() {
    const next = !marked;
    startTransition(async () => {
      try {
        const result = await setPoison(workId, next);
        setMarked(result.isPoison);
        router.refresh();
      } catch {
        toast.error(
          `Could not update the ${POISON_LABEL.toLowerCase()} mark. Try again.`,
        );
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={marked}
      aria-busy={pending}
      aria-label={marked ? POISON_UNMARK : POISON_MARK}
      title={
        marked
          ? `${POISON_LABEL} · ${POISON_HINT}. Click to unmark`
          : `${POISON_MARK}: ${POISON_HINT.toLowerCase()}`
      }
      onClick={toggle}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors hover:bg-bg-tertiary focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-red disabled:opacity-50 ${marked ? "text-accent-red" : "text-fg-muted hover:text-accent-red"}`}
    >
      <Skull
        className="h-4 w-4"
        strokeWidth={1.5}
        fill={marked ? "currentColor" : "none"}
        fillOpacity={0.18}
        aria-hidden="true"
      />
    </button>
  );
}
