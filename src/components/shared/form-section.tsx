"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

/** A functional field group, shared by edition and copy forms. */
export function FormSection({
  title,
  defaultOpen = false,
  keepMounted = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** Keep state-bearing fields in the draft while the section is collapsed. */
  keepMounted?: boolean;
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
          aria-controls={open || keepMounted ? id : undefined}
          onClick={() => setOpen(!open)}
          className="flex w-full items-start gap-2 text-left hover:text-fg-primary pointer-coarse:min-h-11"
        >
          <CapAligned height={12}>
            <Icon className="h-3 w-3" strokeWidth={1.5} aria-hidden />
          </CapAligned>
          <span>{title}</span>
        </button>
      </h3>
      {keepMounted ? (
        // Preserve draft values while collapsed; disabled fields also stay
        // out of native validation until the person opens the section.
        <fieldset
          id={id}
          hidden={!open}
          inert={!open}
          disabled={!open}
          className="mx-0 mb-0 mt-4 min-w-0 space-y-4 border-0 p-0"
        >
          {children}
        </fieldset>
      ) : open && (
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
