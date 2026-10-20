import Link from "next/link";
import { LibraryBig } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { DOMAIN_ORDER, WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { HomeKind } from "@/lib/catalogue/domain-homes";

/** "a film, a perfume or a painting", each a link to add one */
function OtherKindLinks({ kinds }: { kinds: HomeKind[] }) {
  return kinds.map((kind, index) => (
    <span key={kind}>
      {index === 0 ? "" : index === kinds.length - 1 ? " or " : ", "}a{" "}
      <Link href={`${WORK_DOMAINS[kind].basePath}/new`} className="underline underline-offset-2 transition-colors hover:text-fg-primary touch-hit">
        {WORK_DOMAINS[kind].label.toLowerCase()}
      </Link>
    </span>
  ));
}

/**
 * Before the first record, one state in place of an index of zeros: what
 * the library is for, Add book, and quiet links to the other collections
 * (SLN-1184)
 */
export function EmptyCatalogue() {
  const kinds = DOMAIN_ORDER.filter((kind): kind is HomeKind => kind !== "book");
  return (
    <EmptyState
      icon={LibraryBig}
      heading="h2"
      title="Nothing catalogued yet"
      description="Durtal keeps one record of every book you own, read or want, with its editions and copies. What you read, what comes in and the numbers gather here from the first book."
      action={
        <div className="flex flex-col items-center gap-4">
          <DomainAddLink kind="book" />
          {kinds.length > 0 && (
            <p className="text-center text-sm text-fg-secondary">
              Or add <OtherKindLinks kinds={kinds} />.
            </p>
          )}
        </div>
      }
    />
  );
}
