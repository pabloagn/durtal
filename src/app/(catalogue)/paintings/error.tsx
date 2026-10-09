"use client";

import { DomainError } from "@/components/domains/domain-states";

export default function PaintingsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DomainError kind="painting" {...props} />;
}
