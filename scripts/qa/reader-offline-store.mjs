#!/usr/bin/env node
/** Focused native Chromium IndexedDB and two-page Web Lock checks. No app,
 * PostgreSQL, production build, network services or manual :3100 session.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve("vitest/package.json"));
const { build } = await import(pathToFileURL(viteRequire.resolve("vite")).href);
const root = resolve(new URL("../../", import.meta.url).pathname);
const workspace = mkdtempSync(join(tmpdir(), "reader-offline-store-"));
let chrome, ws, server;
try {
  await build({
    configFile: false,
    root,
    logLevel: "error",
    resolve: { alias: { "@": join(root, "src") } },
    build: {
      outDir: join(workspace, "bundle"),
      minify: false,
      lib: {
        entry: join(root, "src/__tests__/reader/offline/store-browser.ts"),
        formats: ["es"],
        fileName: () => "store.js",
      },
    },
  });
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      req.url === "/store.js" ? "text/javascript" : "text/html",
    );
    res.end(
      req.url === "/store.js"
        ? readFileSync(join(workspace, "bundle/store.js"))
        : "<!doctype html><title>Native reader storage checks</title>",
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let executable = process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const dir of existsSync(cache)
    ? readdirSync(cache).sort().reverse()
    : []) {
    if (!dir.startsWith("chromium_headless_shell-")) continue;
    for (const folder of [
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell-mac-x64",
      "chrome-headless-shell-linux64",
    ]) {
      const candidate = join(cache, dir, folder, "chrome-headless-shell");
      if (!executable && existsSync(candidate)) executable = candidate;
    }
  }
  if (!executable)
    throw new Error("Native Chromium unavailable; no check may be skipped");
  chrome = spawn(
    executable,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${join(workspace, "profile")}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const active = join(workspace, "profile/DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(active); i++) await sleep(50);
  if (!existsSync(active)) throw new Error("Chromium did not start");
  const [port, path] = readFileSync(active, "utf8").trim().split("\n");
  ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((r, reject) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id) return;
    const target = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) target?.reject(new Error(msg.error.message));
    else target?.resolve(msg.result);
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      ws.send(
        JSON.stringify({
          id: next,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  async function page() {
    const { targetId } = await call("Target.createTarget", { url: origin });
    const { sessionId } = await call("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    for (let i = 0; i < 100; i++) {
      const state = await call(
        "Runtime.evaluate",
        { expression: "location.origin", returnByValue: true },
        sessionId,
      );
      if (state.result.value === origin) break;
      await sleep(10);
    }
    return async (expression) => {
      const result = await call(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text,
        );
      return result.result.value;
    };
  }
  const a = await page(),
    b = await page();
  const report = await a(
    "import('/store.js').then(m => m.runOfflineStoreChecks())",
  );
  const name = `two-page-lock-${Date.now()}`;
  await a(
    `import('/store.js').then(async m => { globalThis.check = await m.prepareLockCheck(${JSON.stringify(name)}, false); check.start(); })`,
  );
  for (let i = 0; i < 100 && !(await a("check.sends()")); i++) await sleep(10);
  await b(
    `import('/store.js').then(async m => { globalThis.check = await m.prepareLockCheck(${JSON.stringify(name)}, true); check.start(); })`,
  );
  await sleep(100);
  if (await b("check.sends()"))
    throw new Error(
      "Second page stole live network ownership after lease expiry",
    );
  const first = await a("check.finish()"),
    second = await b("check.finish()");
  if (
    first.sends !== 1 ||
    second.sends !== 0 ||
    first.queued !== 0 ||
    second.queued !== 0
  )
    throw new Error("Duplicate multi-tab delivery");
  await a("check.close()");
  await b("check.close()");
  report.passed++;
  report.checks.push(
    "two native pages cannot steal an expired lease while its origin Web Lock is held",
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  ws?.close();
  if (chrome) {
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await exited;
  }
  if (server) await new Promise((r) => server.close(r));
  rmSync(workspace, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
