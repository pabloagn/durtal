"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  BOOK_LINK_SITES,
  parseBookLink,
  type BookLinkField,
} from "@/lib/validations/book-links";

export type BookLinkValues = Record<BookLinkField, string>;

const FIELDS = Object.keys(BOOK_LINK_SITES) as BookLinkField[];

export function bookLinkValues(work: {
  goodreadsUrl?: string | null;
  storygraphUrl?: string | null;
}): BookLinkValues {
  return {
    goodreadsUrl: work.goodreadsUrl ?? "",
    storygraphUrl: work.storygraphUrl ?? "",
  };
}

/** Parse the form values for saving: canonical links, or the first error. */
export function parseBookLinkValues(
  values: BookLinkValues,
):
  | { ok: true; links: Record<BookLinkField, string | null> }
  | { ok: false; error: string } {
  const links = {} as Record<BookLinkField, string | null>;
  for (const field of FIELDS) {
    const parsed = parseBookLink(field, values[field]);
    if (!parsed.ok) return parsed;
    links[field] = parsed.value;
  }
  return { ok: true, links };
}

/** "Book Links" section for the work edit dialogs. Errors show after a field loses focus. */
export function BookLinksFields({
  idPrefix,
  values,
  onChange,
}: {
  idPrefix: string;
  values: BookLinkValues;
  onChange: (values: BookLinkValues) => void;
}) {
  const [touched, setTouched] = useState<
    Partial<Record<BookLinkField, boolean>>
  >({});

  return (
    <section>
      <h3 className="mb-3 font-serif text-lg text-fg-secondary">Book Links</h3>
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((field) => {
          const site = BOOK_LINK_SITES[field];
          const parsed = parseBookLink(field, values[field]);
          return (
            <Input
              key={field}
              id={`${idPrefix}-${field}`}
              label={site.label}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={values[field]}
              onChange={(e) => onChange({ ...values, [field]: e.target.value })}
              onBlur={() => setTouched((prev) => ({ ...prev, [field]: true }))}
              placeholder={site.placeholder}
              error={touched[field] && !parsed.ok ? parsed.error : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
