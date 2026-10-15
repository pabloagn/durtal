import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Perfume not found" };

/** An address that names no perfume: it was deleted, or mistyped. */
export default function PerfumeNotFound() {
  return (
    <EmptyState
      heading="h1"
      icon={SearchX}
      title="Perfume not found"
      description="It may have been deleted, or the address may be mistyped."
      action={
        <Link href="/perfumes" className={buttonClass("secondary")}>
          Back to perfumes
        </Link>
      }
    />
  );
}
