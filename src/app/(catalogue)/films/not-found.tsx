import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

/** An address that names no film: it was deleted, or mistyped. */
export default function FilmNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Film not found"
      description="It may have been deleted, or the address may be mistyped."
      action={
        <Link href="/films" className={buttonClass("ghost")}>
          Back to films
        </Link>
      }
    />
  );
}
