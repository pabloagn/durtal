"use client";

import { forwardRef, useRef, type ComponentProps } from "react";
import { CaseSensitive } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  FieldActionButton,
  replaceFieldText,
} from "@/components/shared/field-action";
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
            icon={CaseSensitive}
            label="Capitalize title"
            active={capitalized !== value}
            disabled={disabled}
            onClick={() =>
              replaceFieldText(inputRef.current, capitalized, onValueChange)
            }
          />
        }
        {...props}
      />
    );
  },
);

TitleInput.displayName = "TitleInput";
