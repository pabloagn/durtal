import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { prepareOfflineAssets } from "../prepare-offline.mjs";

const NEXT_ID = "Next_generated-Release_27";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "durtal-offline-build-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, path, bytes) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

test("actual offline preparation hashes its completed build graph and preserves the Next ID", async t => {
  const root = await scratch(t);
  await put(root, ".next/BUILD_ID", NEXT_ID + "\n");
  for (const route of ["reader/offline", "(offline)/ebooks/offline", "(offline)/offline"])
    await put(root, `.next/server/app/${route}/page_client-reference-manifest.js`, '"static/chunks/entry.js"');
  await put(root, ".next/static/chunks/entry.js", 'import("./reader.js"); "static/chunks/style.css";');
  await put(root, ".next/static/chunks/reader.js", 'export const fixture = "reader bytes";');
  await put(root, ".next/static/chunks/style.css", 'src:url("../media/fixture.woff2")');
  await put(root, ".next/static/media/fixture.woff2", "fixture font bytes");
  await put(root, "public/fonts/reader/reader.woff2", "reader font bytes");
  await put(root, "public/vendor/pdfjs/fixture/worker.mjs", "PDF worker bytes");
  // This calls the real script and sharp icon generation; no mocked graph or writer.
  await prepareOfflineAssets(root);
  const manifest = JSON.parse(await readFile(join(root, "public/offline-assets.json"), "utf8"));
  assert.equal(manifest.v, 1);
  assert.equal(manifest.buildId, NEXT_ID);
  assert.equal(await readFile(join(root, ".next/BUILD_ID"), "utf8"), NEXT_ID + "\n");
  assert.deepEqual(manifest.assets.map(item => item.url), [
    "/_next/static/chunks/entry.js", "/_next/static/chunks/reader.js", "/_next/static/chunks/style.css",
    "/_next/static/media/fixture.woff2", "/fonts/reader/reader.woff2",
    "/icons/durtal-192.png", "/icons/durtal-512.png", "/icons/durtal-maskable-512.png",
    "/vendor/pdfjs/fixture/worker.mjs",
  ]);
  for (const item of manifest.assets) {
    const path = item.url.startsWith("/_next/")
      ? join(root, ".next", item.url.slice(7)) : join(root, "public", item.url.slice(1));
    assert.equal(item.sha256, hash(await readFile(path)), item.url);
  }
});

test("missing or malformed emitted IDs fail before producing public output", async t => {
  for (const id of [null, "", "bad/id", "bad?query", "bad\nsecond-line", "x".repeat(129)]) {
    const root = await scratch(t);
    if (id !== null) await put(root, ".next/BUILD_ID", id);
    await assert.rejects(prepareOfflineAssets(root));
    await assert.rejects(access(join(root, "public/icons")));
    await assert.rejects(access(join(root, "public/offline-assets.json")));
  }
});

test("actual CLI refuses a malformed emitted ID even when environment labels look valid", async t => {
  const root = await scratch(t);
  await put(root, "scripts/prepare-offline.mjs", await readFile(new URL("../prepare-offline.mjs", import.meta.url)));
  await put(root, ".next/BUILD_ID", "bad/id");
  const result = spawnSync(process.execPath, [join(root, "scripts/prepare-offline.mjs")], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { DURTAL_BUILD_COMMIT: "a".repeat(40), DURTAL_BUILD_TREE: "b".repeat(40), DURTAL_BUILD_ID: "a".repeat(40) },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Offline assets require a valid emitted Next build ID/);
  await assert.rejects(access(join(root, "public/offline-assets.json")));
});

// Execute the actual classical worker against structural cache/network fixtures.
// This checks its identity protocol, not native service-worker lifecycle behavior.
async function worker(buildId, manifestId = buildId) {
  const listeners = new Map(), opened = [], cachesByName = new Map();
  const bytes = Buffer.from("immutable reader bytes");
  const assetUrl = "https://durtal.test/_next/static/chunks/reader.js";
  const cacheApi = {
    has: async name => cachesByName.has(name),
    open: async name => {
      opened.push(name);
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const values = cachesByName.get(name);
      return { put: async (key, value) => values.set(typeof key === "string" ? key : key.url, value),
        match: async key => values.get(typeof key === "string" ? key : key.url) };
    },
    delete: async name => cachesByName.delete(name),
  };
  const fetch = async input => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/offline-assets.json") return Response.json({ v: 1, buildId: manifestId,
      assets: [{ url: "/_next/static/chunks/reader.js", sha256: hash(bytes) }] });
    if (url === assetUrl) return new Response(bytes);
    return new Response("<html>Offline shell</html>", { headers: { "Content-Type": "text/html" } });
  };
  runInNewContext(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self: { location: { href: `https://durtal.test/sw.js?build=${encodeURIComponent(buildId)}`, origin: "https://durtal.test" },
      addEventListener: (name, listener) => listeners.set(name, listener), clients: { claim: async () => {} } },
    URL, Response, crypto: webcrypto, caches: cacheApi, fetch,
  });
  async function install() {
    let pending;
    listeners.get("install")({ waitUntil: promise => { pending = promise; } });
    await pending;
  }
  return { install, listeners, opened, assetUrl };
}

test("actual worker installs a non-commit Next ID and uses the announced client's build cache", async () => {
  const actual = await worker(NEXT_ID);
  await actual.install();
  assert.deepEqual(actual.opened, [`durtal-assets-${NEXT_ID}`, `durtal-shell-${NEXT_ID}`]);
  actual.listeners.get("message")({ data: { type: "CLIENT_BUILD", buildId: "older_Next-id" }, source: { id: "client" } });
  let pending;
  actual.listeners.get("fetch")({ request: new Request(actual.assetUrl), clientId: "client",
    respondWith: promise => { pending = promise; } });
  await pending;
  assert.equal(actual.opened.at(-1), "durtal-assets-older_Next-id");
  for (const invalid of ["bad/id", "x".repeat(129), 123])
    actual.listeners.get("message")({ data: { type: "CLIENT_BUILD", buildId: invalid }, source: { id: "client" } });
  actual.listeners.get("fetch")({ request: new Request(actual.assetUrl), clientId: "client",
    respondWith: promise => { pending = promise; } });
  await pending;
  assert.equal(actual.opened.at(-1), "durtal-assets-older_Next-id");
});

test("actual worker refuses mismatched or malformed IDs before opening caches", async () => {
  for (const [requested, manifest] of [[NEXT_ID, "other_Next-id"], ["bad/id", "bad/id"], ["x".repeat(129), "x".repeat(129)]]) {
    const actual = await worker(requested, manifest);
    await assert.rejects(actual.install());
    assert.deepEqual(actual.opened, []);
  }
});
