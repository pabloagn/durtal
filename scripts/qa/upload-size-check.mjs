/**
 * Upload size check: large multipart bodies must reach the API routes whole.
 *
 * src/proxy.ts runs on every API route, and Next.js then passes the route
 * only `experimental.proxyClientMaxBodySize` of the body (next.config.ts).
 * This sends 9, 12 and 49 MB uploads to /api/media/upload without an owner,
 * so the route parses the whole body and then refuses it (400, "Missing
 * required fields"). Nothing is stored. A cut body answers "did not arrive
 * intact" (INVALID_MULTIPART) instead.
 *
 *   node scripts/qa/upload-size-check.mjs http://127.0.0.1:3100
 */
const base = process.argv[2] ?? "http://127.0.0.1:3100";
let failed = 0;

for (const megabytes of [9, 12, 49]) {
  const form = new FormData();
  const bytes = new Uint8Array(megabytes * 1024 * 1024);
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), `check-${megabytes}mb.jpg`);
  form.append("mediaType", "poster");
  const response = await fetch(`${base}/api/media/upload`, {
    method: "POST",
    body: form,
    headers: { "sec-fetch-site": "same-origin" },
  });
  const body = await response.json().catch(() => ({}));
  const parsed = response.status === 400 && String(body.error).startsWith("Missing required fields");
  if (!parsed) failed++;
  console.log(`${megabytes} MB: ${response.status} ${body.code ?? ""} ${parsed ? "parsed" : "NOT PARSED"}`);
}

process.exit(failed ? 1 : 0);
