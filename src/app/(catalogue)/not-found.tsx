import Link from "next/link";
import { FileX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

/**
 * An address that names no page. It shows in the app shell, whose menu is
 * the reader's way out; the dashboard is the button's.
 */
export default function NotFound() {
  return (
    <EmptyState
      heading="h1"
      icon={FileX}
      title="Page not found"
      description="The page you are looking for does not exist or has been moved."
      action={
        <Link href="/" className={buttonClass("secondary")}>
          Go to the dashboard
        </Link>
      }
    />
  );
}
