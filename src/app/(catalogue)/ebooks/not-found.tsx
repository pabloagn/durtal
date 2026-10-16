import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "eBook not found" };

/** An address that names no eBook: it was removed, or mistyped (SLN-685). */
export default function EbookNotFound() {
  return (
    <EmptyState
      heading="h1"
      icon={SearchX}
      title="eBook not found"
      description="It may have been removed, or the address may be mistyped."
      action={
        <Link href="/ebooks" className={buttonClass("secondary")}>
          Back to eBooks
        </Link>
      }
    />
  );
}
