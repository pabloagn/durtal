import { notFound } from "next/navigation";

// The not-found view's own title reaches the first response only; this one
// stays once the page has loaded
export const metadata = { title: "Page not found" };

/**
 * Every address no other page matches: the catalogue's not-found view, in the
 * app shell (`global-not-found.tsx` stays the fallback for addresses outside
 * this layout and for a shell that cannot render).
 */
export default function MissingPage() {
  notFound();
}
