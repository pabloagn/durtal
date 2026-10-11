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
async function putBootstrapManifests(root, manifest = { rootMainFiles: ["static/chunks/entry.js"], polyfillFiles: [] }) {
  for (const path of [".next/build-manifest.json", ...["reader/offline", "(offline)/ebooks/offline", "(offline)/offline"].map(route => `.next/server/app/${route}/page/build-manifest.json`)])
    await put(root, path, JSON.stringify(manifest));
}

test("actual offline preparation hashes its completed build graph and preserves the Next ID", async t => {
  const root = await scratch(t);
  await put(root, ".next/BUILD_ID", NEXT_ID + "\n");
  await putBootstrapManifests(root);
  for (const route of ["reader/offline", "(offline)/ebooks/offline", "(offline)/offline"])
    await put(root, `.next/server/app/${route}/page_client-reference-manifest.js`, '"static/chunks/entry.js"');
  await put(root, ".next/static/chunks/entry.js", 'import("./reader.js"); "static/chunks/style.css";');
  await put(root, ".next/static/chunks/reader.js", 'export const fixture = "reader bytes";');
  await put(root, ".next/static/chunks/style.css", 'src:url("../media/fixture.woff2")');
  await put(root, ".next/static/media/fixture.woff2", "fixture font bytes");
  await put(root, "public/fonts/reader/reader.woff2", "reader font bytes");
  await put(root, "public/vendor/pdfjs/fixture/worker.mjs", "PDF worker bytes");
  const stamp = "fixture build provenance\n";
  await put(root, "public/vendor/pdfjs/fixture/.version", stamp);
  await put(root, "public/vendor/pdfjs/fixture/.staging/worker.mjs", "private staging bytes");
  await put(root, "public/fonts/reader/.metadata", "private font metadata");
  await put(root, "public/vendor/pdfjs/fixture/ASSETS.json", '{"v":1}');
  await put(root, "public/vendor/pdfjs/fixture/cmaps/Fixture.bcmap", "character-map bytes");
  // This calls the real script and sharp icon generation; no mocked graph or writer.
  await prepareOfflineAssets(root);
  const manifest = JSON.parse(await readFile(join(root, "public/offline-assets.json"), "utf8"));
  assert.equal(manifest.v, 1);
  assert.equal(manifest.buildId, NEXT_ID);
  assert.equal(await readFile(join(root, ".next/BUILD_ID"), "utf8"), NEXT_ID + "\n");
  // Preparation keeps build provenance intact while excluding hidden URLs.
  assert.equal(await readFile(join(root, "public/vendor/pdfjs/fixture/.version"), "utf8"), stamp);
  assert.equal(await readFile(join(root, "public/vendor/pdfjs/fixture/.staging/worker.mjs"), "utf8"), "private staging bytes");
  assert.ok(manifest.assets.every(item => !item.url.split("/").some(segment => segment.startsWith("."))));
  assert.deepEqual(manifest.assets.map(item => item.url), [
    "/_next/static/chunks/entry.js", "/_next/static/chunks/reader.js", "/_next/static/chunks/style.css",
    "/_next/static/media/fixture.woff2", "/fonts/reader/reader.woff2",
    "/icons/durtal-192.png", "/icons/durtal-512.png", "/icons/durtal-maskable-512.png",
    "/vendor/pdfjs/fixture/ASSETS.json", "/vendor/pdfjs/fixture/cmaps/Fixture.bcmap",
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
async function worker(buildId, manifestId = buildId, responses = {}) {
  const listeners = new Map(), opened = [], cachesByName = new Map();
  const bytes = Buffer.from("immutable reader bytes");
  const assetPath = responses.assetPath ?? "/_next/static/chunks/reader.js";
  const assetUrl = `https://durtal.test${assetPath}`;
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
      assets: [{ url: assetPath, sha256: hash(bytes) }] });
    if (url === assetUrl) {
      const response = new Response(responses.assetBytes ?? bytes, { status: responses.assetStatus ?? 200,
        statusText: responses.assetStatusText ?? "", headers: responses.assetHeaders });
      // Native fetched/cache responses retain their network URL; Node's constructor does not.
      Object.defineProperty(response, "url", { value: assetUrl });
      return response;
    }
    return new Response("<html>Offline shell</html>", { status: responses.shellStatus ?? 200,
      headers: { "Content-Type": responses.shellContentType ?? "text/html" } });
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
  return { install, listeners, opened, assetUrl, cachesByName };
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

test("cached immutable responses keep request URL semantics and exact status, headers and bytes", async () => {
  for (const [assetPath, contentType] of [
    ["/_next/static/chunks/reader.js", "text/javascript; charset=utf-8"],
    ["/_next/static/chunks/reader.mjs", "text/javascript; charset=utf-8"],
    ["/_next/static/chunks/reader.css", "text/css; charset=utf-8"],
    ["/fonts/reader/reader.woff2", "font/woff2"],
    ["/vendor/pdfjs/fixture/worker.mjs", "text/javascript; charset=utf-8"],
  ]) {
    const actual = await worker(NEXT_ID, NEXT_ID, { assetPath, assetStatusText: "OK",
      assetHeaders: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": String(Buffer.byteLength("immutable reader bytes")), ETag: '"fixture-release"' } });
    await actual.install();
    const saved = actual.cachesByName.get(`durtal-assets-${NEXT_ID}`).get(actual.assetUrl);
    assert.equal(saved.url, actual.assetUrl, "fixture must expose the cached network response URL");
    let pending;
    actual.listeners.get("fetch")({ request: new Request(actual.assetUrl), clientId: "client",
      respondWith: promise => { pending = promise; } });
    const served = await pending;
    // An empty response URL lets the browser retain the original worker/module/CSS request base.
    // Native worker location/fragment behavior requires the separate browser gate.
    assert.equal(served.url, "", assetPath);
    assert.notStrictEqual(served, saved, assetPath);
    assert.equal(served.status, saved.status, assetPath);
    assert.equal(served.statusText, "OK", assetPath);
    assert.deepEqual([...served.headers], [...saved.headers], assetPath);
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(Buffer.from("immutable reader bytes")), assetPath);
    // Cache misses still return the network response with its original URL.
    actual.listeners.get("message")({ data: { type: "CLIENT_BUILD", buildId: "older_Next-id" }, source: { id: "client" } });
    actual.listeners.get("fetch")({ request: new Request(actual.assetUrl), clientId: "client",
      respondWith: promise => { pending = promise; } });
    assert.equal((await pending).url, actual.assetUrl, assetPath);
  }
});

test("actual worker refuses mismatched or malformed IDs before opening caches", async () => {
  for (const [requested, manifest] of [[NEXT_ID, "other_Next-id"], ["bad/id", "bad/id"], ["x".repeat(129), "x".repeat(129)]]) {
    const actual = await worker(requested, manifest);
    await assert.rejects(actual.install());
    assert.deepEqual(actual.opened, []);
  }
});

test("actual worker keeps strict asset and shell checks and removes incomplete new caches", async () => {
  for (const { name, responses, message } of [
    { name: "failed immutable asset", responses: { assetStatus: 500 }, message: "Incomplete offline install" },
    { name: "changed immutable bytes", responses: { assetBytes: Buffer.from("changed bytes") }, message: "Offline asset changed during install" },
    { name: "failed offline shell", responses: { shellStatus: 400 }, message: "Incomplete offline install" },
    { name: "non-document shell", responses: { shellContentType: "text/plain" }, message: "Offline shell is not a document" },
  ]) {
    const actual = await worker(NEXT_ID, NEXT_ID, responses);
    await assert.rejects(actual.install(), { message }, name);
    assert.equal(actual.cachesByName.size, 0, name);
    assert.deepEqual(actual.opened, [`durtal-assets-${NEXT_ID}`, `durtal-shell-${NEXT_ID}`], name);
  }
});

// Exercise the production collector, including its real hashing/icon writer.
async function dependencyFixture(t, entry) {
  const root = await scratch(t);
  await put(root, ".next/BUILD_ID", NEXT_ID + "\n");
  await putBootstrapManifests(root);
  for (const route of ["reader/offline", "(offline)/ebooks/offline", "(offline)/offline"])
    await put(root, `.next/server/app/${route}/page_client-reference-manifest.js`, '"static/chunks/entry.js"');
  await put(root, ".next/static/chunks/entry.js", entry);
  await put(root, "public/fonts/reader/reader.woff2", "reader font bytes");
  await put(root, "public/vendor/pdfjs/fixture/worker.mjs", "PDF worker bytes");
  return root;
}

test("emitted framework and offline-route bootstraps retain their transitive bytes without catalogue roots", async t => {
  const root = await dependencyFixture(t, 'export const reader = true;');
  await put(root, ".next/build-manifest.json", JSON.stringify({
    rootMainFiles: ["static/chunks/framework~entry.js"], polyfillFiles: ["static/chunks/polyfill.js"],
    pages: { "/catalogue": ["static/chunks/catalogue.js"] }, lowPriorityFiles: ["static/chunks/catalogue-lazy.js"],
  }));
  await put(root, ".next/server/app/(offline)/offline/page/build-manifest.json", JSON.stringify({
    rootMainFiles: ["static/chunks/offline-route-bootstrap.js"], polyfillFiles: [],
  }));
  const files = {
    ".next/static/chunks/framework~entry.js": 'import("./framework-helper.js");',
    ".next/static/chunks/framework-helper.js": '"static/chunks/framework.css";',
    ".next/static/chunks/framework.css": 'src:url("../media/framework.woff2")',
    ".next/static/media/framework.woff2": "framework font bytes",
    ".next/static/chunks/polyfill.js": "const frameworkPolyfill = true;",
    ".next/static/chunks/offline-route-bootstrap.js": 'new Worker(new URL("./offline-worker.mjs", import.meta.url));',
    ".next/static/chunks/offline-worker.mjs": "const offlineWorker = true;",
  };
  for (const [path, bytes] of Object.entries(files)) await put(root, path, bytes);
  await put(root, ".next/static/chunks/catalogue.js", 'import("./catalogue-lazy.js");');
  await put(root, ".next/static/chunks/catalogue-lazy.js", "unrelated catalogue bytes");
  await prepareOfflineAssets(root);
  const manifest = JSON.parse(await readFile(join(root, "public/offline-assets.json"), "utf8"));
  assert.equal(manifest.buildId, NEXT_ID);
  assert.equal(await readFile(join(root, ".next/BUILD_ID"), "utf8"), NEXT_ID + "\n");
  assert.deepEqual(manifest.assets.map(item => item.url), [
    ...Object.keys(files).map(path => "/_next/" + path.slice(".next/".length)),
    "/_next/static/chunks/entry.js", "/fonts/reader/reader.woff2", "/icons/durtal-192.png", "/icons/durtal-512.png",
    "/icons/durtal-maskable-512.png", "/vendor/pdfjs/fixture/worker.mjs",
  ].sort());
  for (const item of manifest.assets) {
    const path = item.url.startsWith("/_next/") ? join(root, ".next", item.url.slice(7)) : join(root, "public", item.url.slice(1));
    assert.equal(item.sha256, hash(await readFile(path)), item.url);
  }
});

test("missing or malformed emitted framework roots cannot publish an offline manifest", async t => {
  for (const bad of [null, { rootMainFiles: [], polyfillFiles: [] }, { rootMainFiles: "static/chunks/entry.js", polyfillFiles: [] },
    { rootMainFiles: ["static/chunks/../private.js"], polyfillFiles: [] }, { rootMainFiles: ["static/chunks/missing-bootstrap.js"], polyfillFiles: [] }]) {
    const root = await dependencyFixture(t, 'export const reader = true;');
    if (bad === null) await rm(join(root, ".next/build-manifest.json"));
    else await put(root, ".next/build-manifest.json", JSON.stringify(bad));
    await assert.rejects(prepareOfflineAssets(root));
    await assert.rejects(access(join(root, "public/offline-assets.json")));
  }
});

test("a missing dependency of an emitted framework bootstrap fails before publishing", async t => {
  const root = await dependencyFixture(t, 'export const reader = true;');
  await put(root, ".next/build-manifest.json", JSON.stringify({ rootMainFiles: ["static/chunks/framework.js"], polyfillFiles: [] }));
  await put(root, ".next/static/chunks/framework.js", 'import("./missing-framework-child.js");');
  await assert.rejects(prepareOfflineAssets(root), error => {
    assert.equal(error.code, "ENOENT");
    assert.equal(error.path, join(root, ".next/static/chunks/missing-framework-child.js"));
    return true;
  });
  await assert.rejects(access(join(root, "public/offline-assets.json")));
});

test("relative configuration literals are not dependencies while real imports, workers and fonts retain their closure", async t => {
  const root = await dependencyFixture(t, `
    const zipDefaults = { workerURI: "./core/web-worker-wasm.js", wasmURI: "./core/streams/zlib-streams.wasm" };
    const pdfDefault = "./pdf.worker.mjs";
    const prose = "import('./string-only.js')";
    /* import("./comment-only.js"); new Worker("./comment-worker.js"); */
    import "./static-import.js";
    export { fixture } from "./reexport.mjs";
    import /* actual lazy dependency */ ("./lazy.mjs");
    new Worker(new URL("./worker.mjs", import.meta.url));
    new SharedWorker("./shared-worker.js");
    importScripts("./worker-import.js");
    audioWorklet.addModule("./worklet.js");
    const emittedChunks = ["static/chunks/hashed~next.js", "static/chunks/style.css"];
  `);
  const files = {
    ".next/static/chunks/static-import.js": "export const fixture = 1;",
    ".next/static/chunks/reexport.mjs": "export const fixture = 2;",
    ".next/static/chunks/lazy.mjs": 'import("./nested.js");',
    ".next/static/chunks/nested.js": "export const fixture = 3;",
    ".next/static/chunks/worker.mjs": "export const fixture = 4;",
    ".next/static/chunks/shared-worker.js": "export const fixture = 5;",
    ".next/static/chunks/worker-import.js": "export const fixture = 6;",
    ".next/static/chunks/worklet.js": "export const fixture = 7;",
    ".next/static/chunks/hashed~next.js": '"static/chunks/deep~next.js";',
    ".next/static/chunks/deep~next.js": "export const fixture = 8;",
    ".next/static/chunks/style.css": '@import "./nested.css";src:url(../media/font~fixture.otf)',
    ".next/static/chunks/nested.css": 'src:url("../media/fixture.woff2")',
    ".next/static/media/font~fixture.otf": "OTF fixture bytes",
    ".next/static/media/fixture.woff2": "WOFF2 fixture bytes",
  };
  for (const [path, bytes] of Object.entries(files)) await put(root, path, bytes);
  await prepareOfflineAssets(root);
  const manifest = JSON.parse(await readFile(join(root, "public/offline-assets.json"), "utf8"));
  assert.equal(manifest.buildId, NEXT_ID);
  assert.deepEqual(manifest.assets.map(item => item.url), [
    ...Object.keys(files).map(path => "/_next/" + path.slice(".next/".length)),
    "/_next/static/chunks/entry.js", "/fonts/reader/reader.woff2",
    "/icons/durtal-192.png", "/icons/durtal-512.png", "/icons/durtal-maskable-512.png",
    "/vendor/pdfjs/fixture/worker.mjs",
  ].sort());
  for (const item of manifest.assets) {
    const path = item.url.startsWith("/_next/")
      ? join(root, ".next", item.url.slice(7)) : join(root, "public", item.url.slice(1));
    assert.equal(item.sha256, hash(await readFile(path)), item.url);
  }
});

for (const { name, entry, css, missing } of [
  { name: "static import", entry: 'import "./core/web-worker-wasm.js";', missing: "static/chunks/core/web-worker-wasm.js" },
  { name: "dynamic import", entry: 'import("./core/web-worker-wasm.js");', missing: "static/chunks/core/web-worker-wasm.js" },
  { name: "re-export", entry: 'export * from "./missing.mjs";', missing: "static/chunks/missing.mjs" },
  { name: "worker URL", entry: 'new Worker(new URL("./missing.mjs", import.meta.url));', missing: "static/chunks/missing.mjs" },
  { name: "worker path", entry: 'new Worker("./core/web-worker-wasm.js");', missing: "static/chunks/core/web-worker-wasm.js" },
  { name: "shared worker", entry: 'new SharedWorker("./missing.js");', missing: "static/chunks/missing.js" },
  { name: "worker script import", entry: 'importScripts("./missing.js");', missing: "static/chunks/missing.js" },
  { name: "worklet module", entry: 'audioWorklet.addModule("./missing.js");', missing: "static/chunks/missing.js" },
  { name: "constructed font URL", entry: 'new URL("../media/missing.ttf", import.meta.url);', missing: "static/media/missing.ttf" },
  { name: "emitted Next chunk with tilde", entry: '"static/chunks/missing~next.js";', missing: "static/chunks/missing~next.js" },
  { name: "CSS font URL", entry: '"static/chunks/style.css";', css: 'src:url(../media/missing~font.otf)', missing: "static/media/missing~font.otf" },
  { name: "CSS import", entry: '"static/chunks/style.css";', css: '@import "./missing.css";', missing: "static/chunks/missing.css" },
]) {
  test(`missing ${name} still fails the real offline collector`, async t => {
    const root = await dependencyFixture(t, entry);
    if (css) await put(root, ".next/static/chunks/style.css", css);
    await assert.rejects(prepareOfflineAssets(root), error => {
      assert.equal(error.code, "ENOENT");
      assert.equal(error.path, join(root, ".next", missing));
      return true;
    });
    await assert.rejects(access(join(root, "public/offline-assets.json")));
  });
}


test("all importScripts arguments retain complete dependency closure and exact hashes", async t => {
  const root = await dependencyFixture(t, 'importScripts("./first.js", `./second.mjs`);');
  const files = {
    ".next/static/chunks/first.js": "const first = true;",
    ".next/static/chunks/second.mjs": 'import("./second-child.js");',
    ".next/static/chunks/second-child.js": "export const secondChild = true;",
  };
  for (const [path, bytes] of Object.entries(files)) await put(root, path, bytes);
  await prepareOfflineAssets(root);
  const manifest = JSON.parse(await readFile(join(root, "public/offline-assets.json"), "utf8"));
  assert.equal(manifest.buildId, NEXT_ID);
  assert.deepEqual(manifest.assets.map(item => item.url), [
    "/_next/static/chunks/entry.js", "/_next/static/chunks/first.js",
    "/_next/static/chunks/second-child.js", "/_next/static/chunks/second.mjs",
    "/fonts/reader/reader.woff2", "/icons/durtal-192.png", "/icons/durtal-512.png",
    "/icons/durtal-maskable-512.png", "/vendor/pdfjs/fixture/worker.mjs",
  ]);
  for (const item of manifest.assets) {
    const path = item.url.startsWith("/_next/")
      ? join(root, ".next", item.url.slice(7)) : join(root, "public", item.url.slice(1));
    assert.equal(item.sha256, hash(await readFile(path)), item.url);
  }
});

test("a missing second importScripts argument fails after an existing first dependency", async t => {
  const root = await dependencyFixture(t, 'importScripts("./first.js", "./core/web-worker-wasm.js");');
  await put(root, ".next/static/chunks/first.js", "const first = true;");
  await assert.rejects(prepareOfflineAssets(root), error => {
    assert.equal(error.code, "ENOENT");
    assert.equal(error.path, join(root, ".next/static/chunks/core/web-worker-wasm.js"));
    return true;
  });
  await assert.rejects(access(join(root, "public/offline-assets.json")));
});
