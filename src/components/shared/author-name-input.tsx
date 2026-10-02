"use client";

import { forwardRef, useRef, type ComponentProps } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  FieldActionButton,
  replaceFieldText,
} from "@/components/shared/field-action";
import { naturalNameParts } from "@/lib/utils/author-names";

type AuthorNameInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "suffix"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Called with the parts when the name is put in natural order */
  onNameOrder?: (parts: { first: string; last: string; sortName: string }) => void;
};

/**
 * An author name field with the harmonizer's name-order fix: "Huxley, Aldous"
 * becomes "Aldous Huxley". The button lights up only when the name has a
 * comma that is a name order.
 */
export const AuthorNameInput = forwardRef<HTMLInputElement, AuthorNameInputProps>(
  ({ value, onValueChange, onNameOrder, disabled, ...props }, ref) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const parts = naturalNameParts(value);

    function fix() {
      if (!parts) return;
      replaceFieldText(inputRef.current, parts.name, onValueChange);
      onNameOrder?.(parts);
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
          <FieldActionButton
            icon={ArrowLeftRight}
            label="Use natural name order"
            active={parts !== null}
            disabled={disabled}
            onClick={fix}
          />
        }
        {...props}
      />
    );
  },
);

AuthorNameInput.displayName = "AuthorNameInput";
