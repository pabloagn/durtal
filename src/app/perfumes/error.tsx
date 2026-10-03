"use client";

import { DomainError } from "@/components/domains/domain-states";

export default function PerfumesError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="perfume" {...props} />;
}
