import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

// SLN-1223: a touch screen keeps :hover on what was tapped last, so every
// hand-written hover waits for a pointer that can hover; held sideways, the
// sticky Settings menu scrolls inside rather than running off the screen.

const src = path.resolve(__dirname, "../..");

/** Each `:hover` rule head with no `(hover: hover)` around it, as file:line */
function hoversOutside(file: string): string[] {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const stack: string[] = [];
  const found: string[] = [];
  let head = "";
  let line = 1;
  for (const ch of css) {
    if (ch === "\n") line++;
    if (ch === "{") {
      const rule = head.trim().replace(/\s+/g, " ");
      stack.push(rule);
      if (rule.includes(":hover") && !stack.some((r) => /hover:\s*hover/.test(r))) found.push(`${path.relative(src, file)}:${line} ${rule}`);
      head = "";
    } else if (ch === "}") {
      stack.pop();
      head = "";
    } else if (ch === ";") head = "";
    else head += ch;
  }
  return found;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "vendor" ? [] : cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

describe("hover on touch screens", () => {
  it("leaves no hand-written :hover outside (hover: hover), apart from Harmonize's (SLN-1110)", () => {
    const outside = cssFiles(src).filter((file) => !file.includes("harmonize")).flatMap(hoversOutside);
    expect(outside).toEqual([]);
  });

  it("finds a hover that is outside, and passes one inside", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hover-"));
    const tmp = path.join(dir, "sample.css");
    writeFileSync(tmp, ".a:hover { color: red; }\n@media (hover: hover) { .b:hover { color: red; } }\n@utility c { @media (hover: hover) { &:hover { color: red; } } }\n");
    try {
      expect(hoversOutside(tmp)).toHaveLength(1);
      expect(hoversOutside(tmp)[0]).toMatch(/sample\.css:1 \.a:hover$/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("keeps Sonner's own close-button hover at rest on touch", () => {
    const css = readFileSync(path.join(src, "styles/globals.css"), "utf8");
    expect(css).toMatch(/@media \(hover: none\) \{\s*:root \[data-sonner-toaster\] \[data-sonner-toast\] \[data-close-button\] \{\s*--gray2: transparent;/);
  });
});

describe("the Settings menu held sideways", () => {
  it("is never taller than the screen, and scrolls inside with room for a focus outline", () => {
    const nav = readFileSync(path.join(src, "components/settings/settings-nav.tsx"), "utf8");
    expect(nav).toContain("md:sticky md:top-6 md:-m-1 md:max-h-[calc(100dvh-3rem+0.5rem)] md:self-start md:overflow-y-auto md:overscroll-contain md:p-1");
  });
});
