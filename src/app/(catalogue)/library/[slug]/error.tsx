"use client";

import { DomainError } from "@/components/domains/domain-states";

/** One book failed to load: it says so, and the way back is the list */
export default function BookError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="book" record {...props} />;
}
