"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/**
 * A link out of an add form to a work already in the catalogue (SLN-667).
 * Nothing is saved before the form's own save, so when the form holds what
 * the person entered, the form's unsaved-work guard (SLN-631) asks Save,
 * Discard or Keep editing before the link leaves it. What the form does not
 * count as entered (a search result picked, a film's title typed to find
 * it) is no reason to ask: the link then opens at once.
 */
export function OpenWorkLink({
  href,
  label,
  dirty,
  variant = "secondary",
}: {
  href: string;
  label: string;
  /** The form holds something the person entered */
  dirty: boolean;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <Link href={href} className={buttonClass(variant)} data-leave={dirty ? undefined : "free"}>
      {label}
    </Link>
  );
}
