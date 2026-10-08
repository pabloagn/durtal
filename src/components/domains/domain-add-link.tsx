import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";

/** The add action of a collection, named after it: "Add perfume". */
export function DomainAddLink({
  kind,
  size = "sm",
}: {
  kind: WorkKind;
  size?: "sm" | "md";
}) {
  const domain = WORK_DOMAINS[kind];
  return (
    <Link
      href={`${domain.basePath}/new`}
      className={`${buttonClass("secondary", size)} whitespace-nowrap`}
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
      Add {domain.label.toLowerCase()}
    </Link>
  );
}

/** The line under a collection home's title. */
export function domainDescription(kind: WorkKind) {
  return `Browse your ${WORK_DOMAINS[kind].label.toLowerCase()} catalogue`;
}
