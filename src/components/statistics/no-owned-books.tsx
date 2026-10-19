import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { NO_OWNED_BOOKS } from "@/lib/statistics/tiles";

/**
 * The statistics before a book is owned, on the dashboard and on /statistics
 * alike (SLN-1184). The dashboard's header already has Add book, so only
 * /statistics carries one here.
 */
export function NoOwnedBooks({ heading }: { heading: "h2" | "h3" }) {
  return (
    <EmptyState
      icon={BarChart3}
      heading={heading}
      title={NO_OWNED_BOOKS.title}
      description={NO_OWNED_BOOKS.description}
      action={heading === "h2" ? <DomainAddLink kind="book" size="md" /> : undefined}
    />
  );
}
