import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Person not found" };

/** An address that names no person: it was deleted or merged, or mistyped. */
export default function PersonNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Person not found"
      description="They may have been merged or deleted, or the address may be mistyped."
      action={
        <Link href="/people" className={buttonClass("ghost")}>
          Back to people
        </Link>
      }
    />
  );
}
