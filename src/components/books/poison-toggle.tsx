"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Skull } from "lucide-react";
import { toast } from "sonner";
import { setPoison } from "@/lib/actions/poison";
import { MARKS } from "@/lib/constants/marks";
import { MarkToggle } from "./mark-toggle";

/** The anathema mark on the book page, beside the rare gem. */
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
        setMarked((await setPoison(workId, next)).isPoison);
        router.refresh();
      } catch {
        toast.error(
          `Could not update the ${MARKS.poison.label} mark. Try again.`,
        );
      }
    });
  }

  return (
    <MarkToggle
      mark={MARKS.poison}
      icon={Skull}
      tone="text-accent-red"
      marked={marked}
      pending={pending}
      onToggle={toggle}
    />
  );
}
