import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

/** An address that names no publishing house: it was merged, deleted or mistyped. */
export default function PublisherNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Publisher not found"
      description="It may have been merged or deleted, or the address may be mistyped."
      action={
        <Link href="/publishers" className={buttonClass("ghost")}>
          Back to publishers
        </Link>
      }
    />
  );
}
