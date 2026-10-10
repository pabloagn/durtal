import type { ReaderPresentation } from "@/lib/validations/reader-preferences";

/** Pure transformations always consume the original declaration, never prior output. */
export function fontSizeInEm(value: string): string {
  const absolute = /^\s*(\d+(?:\.\d+)?|\.\d+)(px|pt)\s*$/i.exec(value);
  if (!absolute) return value;
  const em =
    Number(absolute[1]) / (absolute[2].toLowerCase() === "px" ? 16 : 12);
  return `${Number(em.toFixed(6))}em`;
}

export function adaptTypographyDeclaration(
  property: string,
  original: string,
  p: ReaderPresentation,
  context: { inline?: boolean; protectedTypography?: boolean } = {},
): string {
  if (p.publisherStyles || context.protectedTypography) return original;
  if (property.toLowerCase() === "font-size" && !context.inline)
    return fontSizeInEm(original);
  if (
    property.toLowerCase() === "text-align" &&
    p.textAlign !== "book" &&
    /^(left|start|justify)$/i.test(original.trim())
  )
    return p.textAlign;
  return original;
}
