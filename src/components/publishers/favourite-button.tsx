"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { setPublisherFavourite } from "@/lib/actions/publishers";
export function PublisherFavourite({
  id,
  favourite,
}: {
  id: string;
  favourite: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={
        favourite ? "Remove favourite publisher" : "Favourite publisher"
      }
      aria-pressed={favourite}
      title={favourite ? "Remove favourite" : "Favourite publisher"}
      className="shrink-0 p-2 text-accent-gold disabled:opacity-40"
      onClick={() =>
        start(async () => {
          try {
            await setPublisherFavourite(id, !favourite);
            router.refresh();
          } catch {
            toast.error("Could not update favourite");
          }
        })
      }
    >
      <Star
        className="h-4 w-4"
        strokeWidth={1.5}
        fill={favourite ? "currentColor" : "none"}
      />
    </button>
  );
}
