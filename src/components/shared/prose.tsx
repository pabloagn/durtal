import { EB_Garamond } from "next/font/google";

/**
 * The text serif for long reading. Headings keep PP Cirka; EB Garamond is
 * made for paragraphs: true italic and old-style figures. Declared here, not
 * in the root layout, so it loads (and preloads) only on routes that render
 * <Prose>. Bold (2 descriptions) is synthesized rather than loaded.
 */
const garamond = EB_Garamond({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-prose",
  display: "swap",
});

/**
 * Long reading text: book descriptions, author bios, collection and series
 * descriptions. EB Garamond 21px on 32px lines, about 65 characters per line
 * (`type-prose` in globals.css). Pass sanitized `html`, or children.
 */
export function Prose({
  html,
  children,
  className = "",
}: {
  html?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const classes = `${garamond.variable} type-prose ${className}`.trim();
  return html !== undefined ? (
    <div className={classes} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className={classes}>{children}</div>
  );
}
