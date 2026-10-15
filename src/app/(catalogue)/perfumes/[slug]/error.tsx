"use client";

import { DomainError } from "@/components/domains/domain-states";

/** One perfume failed to load: it says so, and the way back is the list */
export default function PerfumeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="perfume" record {...props} />;
}
