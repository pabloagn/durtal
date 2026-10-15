import { Fragment } from "react";

/**
 * A count line ("1,050 books · 6 editions · 2 films") that wraps only between
 * its parts, so a part is never split from its number and a long line wraps
 * inside its box instead of running past it (SLN-781)
 */
export function CountParts({ line }: { line: string }) {
  return line.split(" · ").map((part, i) => (
    <Fragment key={i}>
      {i > 0 && " · "}
      <span className="whitespace-nowrap">{part}</span>
    </Fragment>
  ));
}
