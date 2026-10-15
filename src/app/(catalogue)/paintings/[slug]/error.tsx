"use client";

import { DomainError } from "@/components/domains/domain-states";

/** One painting failed to load: it says so, and the way back is the list */
export default function PaintingError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="painting" record {...props} />;
}
