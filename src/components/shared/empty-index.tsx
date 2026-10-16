import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A list page with nothing in it at all (SLN-834, SLN-842): its title, any
 * collection tabs, and one empty state that says what the page holds, with
 * one Add. No toolbar over nothing, no Add in the header and no count line.
 * A search or filter that matches nothing is not this: the list keeps its
 * toolbar there, so the query can change.
 */
export function EmptyIndex({
  title,
  tabs,
  icon,
  empty,
  description,
  action,
}: {
  /** The page's title */
  title: string;
  tabs?: React.ReactNode;
  icon: LucideIcon;
  /** "No series yet" */
  empty: string;
  /** One or two sentences: what the thing is, and how one gets here */
  description: string;
  /** The one Add */
  action?: React.ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} tabs={tabs} />
      <EmptyState icon={icon} heading="h2" title={empty} description={description} action={action} />
    </>
  );
}
