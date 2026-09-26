/** Keep display names, accents and catalogue order; never reverse names or infer missing authors. */
export function formatBookClipboardText(title: string, authors: readonly string[]): string {
  const names = [...new Set(authors.map((name) => name.trim()).filter(Boolean))];
  return names.length ? `${title.trim()}, ${names.join(" & ")}` : title.trim();
}

export async function copyBookText(title: string, authors: readonly string[]): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
  await navigator.clipboard.writeText(formatBookClipboardText(title, authors));
}
