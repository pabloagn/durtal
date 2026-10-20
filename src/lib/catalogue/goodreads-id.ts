/** Parsed text keeps leading zeros; the comparison key never passes through Number. */
export function goodreadsBookId(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  return /^\d+$/.test(text) ? text : /\/book\/show\/(\d+)/.exec(text)?.[1] ?? null;
}

export function goodreadsBookKey(value: string | null | undefined): string | null {
  return goodreadsBookId(value)?.replace(/^0+(?=\d)/, "") ?? null;
}
