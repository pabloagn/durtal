import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

/** An address that names no organization: it was deleted, merged or mistyped. */
export default function OrganizationNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title="Organization not found"
      description="It may have been deleted or merged, or the address may be mistyped."
      action={
        <Link href="/organizations" className={buttonClass("ghost")}>
          Back to organizations
        </Link>
      }
    />
  );
}
