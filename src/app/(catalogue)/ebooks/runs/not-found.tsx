import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Run not found" };

/** An address that names no ingestion run; without it an unknown run would read as a missing eBook (SLN-685). */
export default function RunNotFound() {
  return (
    <EmptyState
      heading="h1"
      icon={SearchX}
      title="Run not found"
      description="The address may be mistyped."
      action={
        <Link href="/ebooks/runs" className={buttonClass("secondary")}>
          Back to ingestion runs
        </Link>
      }
    />
  );
}
