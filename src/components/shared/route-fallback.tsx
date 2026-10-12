import type { ReactNode } from "react";
import { SectionHeading } from "@/components/shared/section-heading";

export const routeFallbackActionClass =
  "inline-flex items-center justify-center rounded-sm border border-glass-border bg-bg-secondary px-4 py-1.5 text-sm text-fg-primary transition-colors hover:bg-bg-tertiary pointer-coarse:min-h-11";

/** Fallback content has no data, navigation hook or provider dependency. */
export function RouteFallback({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-6 text-center">
      <SectionHeading title={title} />
      <p className="max-w-sm text-sm leading-relaxed text-fg-secondary">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {children}
      </div>
    </div>
  );
}
