/** Only legacy history stores fractions; tracker positions are percentages. */
export function fractionToPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error("Reader progress must be a fraction from 0 to 1");
  return Math.round(value * 10_000) / 100;
}

export function isReaderEnd(percent: number): boolean {
  return Number.isFinite(percent) && percent >= 99.5 && percent <= 100;
}

/** PostgreSQL character limits count code points, rather than UTF-16 units. */
export function cutChapter(value: string | null | undefined): string | null {
  const chapter = value?.trim();
  if (!chapter) return null;
  const characters: string[] = [];
  for (const character of chapter) {
    characters.push(character);
    if (characters.length === 300) break;
  }
  return characters.join("");
}
