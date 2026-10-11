"use client";

import { DomainError } from "@/components/domains/domain-states";

export default function FilmsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="film" {...props} />;
}
