import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * A detail page's way back to its list ("Back to films"). The page and its
 * loading screen draw the same link, so the header below it starts at the
 * same height in both.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
    >
      <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
      {children}
    </Link>
  );
}
