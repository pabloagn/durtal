"use client";

import { forwardRef, useRef, type ComponentProps } from "react";
import { CaseSensitive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { capitalizeTitle } from "@/lib/utils/title-case";

type TitleInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "suffix"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** The form's language code: it decides the rules when the words do not */
  language?: string | null;
};

/** A title field with a button that capitalizes the title */
export const TitleInput = forwardRef<HTMLInputElement, TitleInputProps>(
  ({ value, onValueChange, language, disabled, ...props }, ref) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const capitalized = capitalizeTitle(value, language);

    function capitalize() {
      const input = inputRef.current;
      if (!input) return;
      // Typed in as an edit, so Cmd+Z undoes it
      input.focus();
      input.select();
      if (!document.execCommand("insertText", false, capitalized))
        onValueChange(capitalized);
    }

    return (
      <Input
        ref={(node) => {
          inputRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        suffix={
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={capitalize}
            disabled={disabled || capitalized === value}
            aria-label="Capitalize title"
            title="Capitalize title"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-rose disabled:pointer-events-none disabled:opacity-40"
          >
            <CaseSensitive className="h-4 w-4" strokeWidth={1.5} />
          </button>
        }
        {...props}
      />
    );
  },
);

TitleInput.displayName = "TitleInput";
