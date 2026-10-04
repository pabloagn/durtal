import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

/** An address that names no perfume: it was deleted, or mistyped. */
export default function PerfumeNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Perfume not found"
      description="It may have been deleted, or the address may be mistyped."
      action={
        <Link href="/perfumes" className={buttonClass("ghost")}>
          Back to perfumes
        </Link>
      }
    />
  );
}
