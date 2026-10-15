"use client";

import { DomainError } from "@/components/domains/domain-states";

/** One film failed to load: it says so, and the way back is the list */
export default function FilmError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="film" record {...props} />;
}
