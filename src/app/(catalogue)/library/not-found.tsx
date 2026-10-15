import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Book not found" };

/** An address that names no book: it was deleted or merged, or mistyped. */
export default function BookNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Book not found"
      description="It may have been deleted or merged, or the address may be mistyped."
      action={
        <Link href="/library" className={buttonClass("ghost")}>
          Back to books
        </Link>
      }
    />
  );
}
