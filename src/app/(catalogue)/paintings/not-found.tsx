import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Painting not found" };

/** An address that names no painting: it was deleted, or mistyped. */
export default function PaintingNotFound() {
  return (
    <EmptyState
      heading="h1"
      icon={SearchX}
      title="Painting not found"
      description="It may have been deleted, or the address may be mistyped."
      action={
        <Link href="/paintings" className={buttonClass("secondary")}>
          Back to paintings
        </Link>
      }
    />
  );
}
