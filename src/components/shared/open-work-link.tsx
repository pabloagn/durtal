"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";

/**
 * A link out of an add form to a work already in the catalogue (SLN-667).
 * Nothing is saved before the form's own save, so when the form holds what
 * the person entered, the first click asks before leaving it behind.
 * SLN-631's shared unsaved-changes guard replaces this question.
 */
export function OpenWorkLink({
  href,
  label,
  dirty,
  variant = "secondary",
}: {
  href: string;
  label: string;
  /** The form holds something the person entered */
  dirty: boolean;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [asking, setAsking] = useState(false);
  const link = useRef<HTMLAnchorElement>(null);
  // "Keep editing" hands focus back to the link it replaced
  const returning = useRef(false);
  useEffect(() => {
    if (asking || !returning.current) return;
    returning.current = false;
    link.current?.focus();
  }, [asking]);
  const keepEditing = () => {
    returning.current = true;
    setAsking(false);
  };
  if (!asking || !dirty)
    return (
      <Link
        ref={link}
        href={href}
        className={buttonClass(variant)}
        onClick={(event) => {
          if (!dirty || event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          setAsking(true);
        }}
      >
        {label}
      </Link>
    );
  return (
    <span
      role="group"
      aria-label="Leave this form?"
      className="inline-flex flex-wrap items-center gap-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        keepEditing();
      }}
    >
      <span className="text-xs text-fg-secondary">What you entered is not saved.</span>
      <Link href={href} className={buttonClass("danger")}>
        Discard and open
      </Link>
      <Button variant="ghost" autoFocus onClick={keepEditing}>
        Keep editing
      </Button>
    </span>
  );
}
