"use client";

import type { ReactNode } from "react";
import { ArrowRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { bindingLabel } from "@/lib/utils/binding";
import { BINDING_TYPES } from "@/lib/types/index";
import { StepFooter } from "../step-progress";
import { LANGUAGE_OPTIONS, type EditionDraft } from "../wizard-model";

/** The edition. A wishlist book can skip its copies */
export function EditionStep({
  edition,
  onChange,
  isbnClash,
  wishlist,
  checking,
  onBack,
  onLeave,
  cancel,
}: {
  edition: EditionDraft;
  onChange: (patch: Partial<EditionDraft>) => void;
  /** Another edition has the ISBN */
  isbnClash: string | null;
  wishlist: boolean;
  /** The ISBN is being checked */
  checking: boolean;
  onBack: () => void;
  onLeave: (next: "instance" | "categorize") => void;
  cancel: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Input
          label="ISBN-13"
          id="isbn13"
          value={edition.isbn13}
          onChange={(e) => onChange({ isbn13: e.target.value })}
          placeholder="9780143108269"
          error={isbnClash ?? undefined}
        />
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Publisher"
            id="publisher"
            value={edition.publisher}
            onChange={(e) => onChange({ publisher: e.target.value })}
            placeholder="Penguin Classics"
          />
          <Input
            label="Publication year"
            id="publicationYear"
            type="number"
            value={edition.publicationYear}
            onChange={(e) => onChange({ publicationYear: e.target.value })}
            placeholder="2016"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Language"
            id="language"
            value={edition.language}
            onChange={(e) => onChange({ language: e.target.value })}
            options={LANGUAGE_OPTIONS}
          />
          <Input
            label="Page count"
            id="pageCount"
            type="number"
            value={edition.pageCount}
            onChange={(e) => onChange({ pageCount: e.target.value })}
          />
        </div>
        <Select
          label="Binding"
          id="binding"
          value={edition.binding}
          onChange={(e) => onChange({ binding: e.target.value })}
          placeholder="Select binding"
          options={BINDING_TYPES.map((b) => ({
            value: b,
            label: bindingLabel(b)!,
          }))}
        />
        <Input
          label="Cover image URL"
          id="coverUrl"
          value={edition.coverUrl}
          onChange={(e) => onChange({ coverUrl: e.target.value })}
          placeholder="https://..."
        />
      </div>

      <StepFooter onBack={onBack} cancel={cancel}>
        {wishlist && (
          <Button
            variant="ghost"
            disabled={checking}
            onClick={() => onLeave("categorize")}
          >
            <SkipForward className="h-3.5 w-3.5" strokeWidth={1.5} />
            Skip copies
          </Button>
        )}
        <Button
          data-shortcut="next"
          disabled={checking}
          onClick={() => onLeave("instance")}
        >
          {wishlist ? "Add copies anyway" : "Add copies"}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </StepFooter>
    </div>
  );
}
