"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

/** A functional field group, shared by edition and copy forms. */
export function FormSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="border-t border-glass-border py-4 first:border-t-0 first:pt-0">
      <h3 className="type-group-title">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(!open)}
          className="flex w-full items-start gap-2 text-left hover:text-fg-primary pointer-coarse:min-h-11"
        >
          <CapAligned height={12}>
            <Icon className="h-3 w-3" strokeWidth={1.5} aria-hidden />
          </CapAligned>
          <span>{title}</span>
        </button>
      </h3>
      {open && (
        <div id={id} className="mt-4 space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** Fields reflow against the form's width, including within expanded dialogs. */
export function FormColumns({
  children,
  three = false,
}: {
  children: ReactNode;
  three?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 @min-[440px]:grid-cols-2 ${three ? "@min-[560px]:grid-cols-3" : ""}`}
    >
      {children}
    </div>
  );
}
