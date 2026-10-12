import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// Build-only: patch the image's pinned dependency. Never patches host dependencies.
if (process.cwd() !== "/inspector" || new URL(import.meta.url).pathname !== "/inspector/patch-pdf.mjs")
  throw new Error("PDF dependency patch may run only inside the separate inspector image build");
const file = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
const expected = "bb422f60804477de4a0b09091d8347a916a387755ed1cbad24ccaec1d09c78bf";
let source = readFileSync(file, "utf8");
if (createHash("sha256").update(source).digest("hex") !== expected) throw new Error("Inspector PDF source differs from the reviewed pinned package");
const replace = (before, after, count = 1) => {
  if (source.split(before).length - 1 !== count) throw new Error("Inspector PDF hook target differs");
  source = source.replaceAll(before, after);
};
const hooks = `const durtalInspectorPdfHooks = () => {
  const hooks = globalThis[Symbol.for("durtal.inspector.pdf-budget.v1")];
  if (!hooks) throw new Error("PDF parsing outside the bounded inspector");
  return hooks;
};
globalThis[Symbol.for("durtal.inspector.pdf-patch.v1")] = "${expected}";\n`;
replace("const emptyBuffer = new Uint8Array(0);", `${hooks}const emptyBuffer = new Uint8Array(0);`);
replace("constructor(maybeMinBufferLength) {\n    super();", "constructor(maybeMinBufferLength) {\n    super();\n    durtalInspectorPdfHooks().length(maybeMinBufferLength || 0);");
replace("ensureBuffer(requested) {\n    const buffer = this.buffer;", "ensureBuffer(requested) {\n    durtalInspectorPdfHooks().length(requested);\n    const buffer = this.buffer;");
replace("const buffer2 = new Uint8Array(size);", "durtalInspectorPdfHooks().buffer(this, size);\n    const buffer2 = new Uint8Array(size);");
replace("const jpegImage = new JpegImage(this.jpegOptions);", "durtalInspectorPdfHooks().jpeg(bytes, this.drawWidth, this.drawHeight);\n    const jpegImage = new JpegImage(this.jpegOptions);");
for (const codec of ["CCITTFaxStream", "Jbig2Stream", "JpxStream"]) {
  const start = source.indexOf(`class ${codec} extends DecodeStream {`);
  const constructor = source.indexOf("super(maybeLength);", start);
  if (start < 0 || constructor < 0 || constructor > start + 512) throw new Error("Opaque PDF codec guard target differs");
  source = source.slice(0, constructor) + source.slice(constructor).replace("super(maybeLength);", `super(maybeLength);\n    durtalInspectorPdfHooks().opaque("${codec}");`);
}
replace("this.image = image;\n    const dict = image.dict;", "this.image = image;\n    const dict = image.dict;\n    durtalInspectorPdfHooks().image(dict.get(\"W\", \"Width\"), dict.get(\"H\", \"Height\"));");
replace('let text = textChunk.str.join("");', 'durtalInspectorPdfHooks().text(textChunk.str.reduce((total, value) => total + value.length, 0) * 4);\n      let text = textChunk.str.join("");');
replace('textChunk.str.push(" ");', 'durtalInspectorPdfHooks().text(1);\n          textChunk.str.push(" ");');
replace('textChunk.str.push(glyphUnicode);', 'durtalInspectorPdfHooks().text(glyphUnicode.length);\n          textChunk.str.push(glyphUnicode);');
replace('textContentItem.str.push(" ");', 'durtalInspectorPdfHooks().text(1);\n          textContentItem.str.push(" ");');
replace("function enqueueChunk(batch = false) {", "function enqueueChunk(batch = false) {\n      durtalInspectorPdfHooks().text(textContent.items.reduce((total, item) => total + (item.str?.length || 1), 0));");
writeFileSync(file, source);
process.stdout.write(`${JSON.stringify({ protocol: 1, pdfjsVersion: "6.4.299", sourceSha256: expected, patchedSha256: createHash("sha256").update(source).digest("hex") })}\n`);
