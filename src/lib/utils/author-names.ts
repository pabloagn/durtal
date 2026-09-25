/** Default sort name for an author: "Last, First Middle" (single names stay as they are). */
export function defaultSortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const last = parts.pop()!;
  return `${last}, ${parts.join(" ")}`;
}
