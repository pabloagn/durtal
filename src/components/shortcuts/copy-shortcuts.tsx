"use client";

import { useCopyItems } from "@/components/shortcuts/shortcuts-provider";
import { COPY_KEYS } from "@/lib/shortcuts/shortcuts";

/**
 * What Y copies on a detail page: Y then A copies the name, T the title, I
 * the ISBN, D the address (Y then L, the link, works everywhere). An entry
 * without text is not offered. Renders nothing.
 */
export function CopyShortcuts({
  name,
  title,
  isbn,
  address,
}: {
  /** The page's name: a book's "Title, Author", an author's name */
  name: string;
  title?: string;
  isbn?: string | null;
  address?: string | null;
}) {
  useCopyItems([
    { key: COPY_KEYS.name, label: "Name", text: name },
    { key: COPY_KEYS.title, label: "Title", text: title },
    { key: COPY_KEYS.isbn, label: "ISBN", text: isbn },
    { key: COPY_KEYS.address, label: "Address", text: address },
  ]);
  return null;
}
