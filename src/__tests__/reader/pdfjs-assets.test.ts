import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { stagePdfjsAssets } from "../../../scripts/qa/stage-pdfjs-assets.mjs";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const temporary = mkdtempSync(join(tmpdir(), "durtal-pdfjs-assets-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("exact installed pdf.js asset staging", () => {
  it("verifies every staged asset against its installed bytes, with reproducible evidence", () => {
    const first = stagePdfjsAssets({
      source,
      destination: join(temporary, "first"),
    });
    const second = stagePdfjsAssets({
      source,
      destination: join(temporary, "second"),
    });
    expect(first.manifestBytes).toEqual(second.manifestBytes);
    expect(first.sha256).toBe(sha256(first.manifestBytes));
    expect(first.manifest.version).toBe("6.4.299");
    expect(first.manifest.apiVersion).toBe("6.4.299");
    expect(first.manifest.mode).toBe("installed-unpatched-staging");
    expect(
      JSON.parse(
        readFileSync(
          new URL("../../vendor/foliate-js/pdfjs-assets.json", import.meta.url),
          "utf8",
        ),
      ),
    ).toEqual(first.manifest);
    expect(readFileSync(join(temporary, "first/VERSION"), "utf8")).toBe(
      "6.4.299\n",
    );
    expect(
      JSON.parse(readFileSync(join(temporary, "first/ASSETS.json"), "utf8")),
    ).toEqual(first.manifest);
    for (const file of first.manifest.files) {
      const original = readFileSync(join(source, file.source));
      const copied = readFileSync(join(temporary, "first", file.path));
      expect(copied.equals(original)).toBe(true);
      expect(copied.length).toBe(file.size);
      expect(sha256(copied)).toBe(file.sha256);
    }
    for (const prefix of ["cmaps/", "standard_fonts/", "wasm/", "iccs/"])
      expect(
        first.manifest.files.some((file) => file.path.startsWith(prefix)),
      ).toBe(true);
    expect(first.manifest.files.some((file) => file.path === "LICENSE")).toBe(
      true,
    );
    expect(
      first.manifest.files.some((file) => file.path === "pdf.worker.min.mjs"),
    ).toBe(true);
  });

  it.each([
    ["6.4.298", "6.4.298"],
    ["6.4.299", "6.4.298"],
  ])(
    "refuses package/API version mismatch %s/%s before publication",
    (packageVersion, apiVersion) => {
      const fake = join(temporary, `fake-${packageVersion}-${apiVersion}`);
      const destination = `${fake}-output`;
      mkdirSync(join(fake, "build"), { recursive: true });
      writeFileSync(
        join(fake, "package.json"),
        JSON.stringify({ version: packageVersion }),
      );
      writeFileSync(
        join(fake, "build/pdf.mjs"),
        `const version = "${apiVersion}";\n`,
      );
      expect(() => stagePdfjsAssets({ source: fake, destination })).toThrow(
        "package/API version",
      );
      expect(existsSync(destination)).toBe(false);
    },
  );
});
