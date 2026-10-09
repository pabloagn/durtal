/** Headless transports for the interaction audit. No package installation. */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const dir of existsSync(cache)
    ? readdirSync(cache).sort().reverse()
    : []) {
    if (!dir.startsWith("chromium_headless_shell-")) continue;
    for (const build of [
      "chrome-headless-shell-mac-arm64",
      "chrome-headless-shell-mac-x64",
      "chrome-headless-shell-linux64",
    ]) {
      const bin = join(cache, dir, build, "chrome-headless-shell");
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error(
    "No Chrome found: set CHROME, or install Playwright's chrome-headless-shell",
  );
}

async function cdpDriver() {
  const executable = findChrome();
  const profile = mkdtempSync(join(tmpdir(), "interaction-audit-"));
  const port = 9800 + Math.floor(Math.random() * 150);
  const chrome = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let socket, launchError;
  chrome.on("error", (error) => {
    launchError = error;
  });
  const pending = new Map();
  async function close() {
    socket?.close();
    if (
      chrome.exitCode === null &&
      chrome.signalCode === null &&
      !launchError
    ) {
      const exited = new Promise((r) => chrome.once("exit", r));
      chrome.kill();
      await Promise.race([exited, sleep(10_000)]);
    }
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
  try {
    let wsUrl;
    for (let i = 0; i < 50 && !wsUrl; i++) {
      if (launchError) throw launchError;
      await sleep(200);
      try {
        wsUrl = (
          await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        ).find((t) => t.type === "page")?.webSocketDebuggerUrl;
      } catch {}
    }
    if (!wsUrl) throw new Error("Chrome did not expose a debugging page");
    socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Chrome socket did not open")),
        10_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Chrome socket failed"));
        },
        { once: true },
      );
    });
    let seq = 0;
    socket.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, 20_000);
        pending.set(id, (m) => {
          clearTimeout(timer);
          m.error ? reject(new Error(m.error.message)) : resolve(m);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    await send("Page.enable");
    await send("Runtime.enable");
    return { send, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function createDriver(name) {
  if (name === "cdp") return cdpDriver();
  if (!["chromium", "firefox", "webkit"].includes(name))
    throw new Error(`Unknown browser ${name}`);
  const runtime =
    process.env.PLAYWRIGHT_CORE ||
    (existsSync("/opt/durtal-qa/node_modules/playwright-core/index.mjs")
      ? "/opt/durtal-qa/node_modules/playwright-core/index.mjs"
      : null);
  const engines = await import(
    runtime ? pathToFileURL(runtime).href : "playwright-core"
  );
  let browser;
  async function launch(touch) {
    browser = await engines[name].launch({
      headless: true,
      ...(name === "chromium" && process.env.CHROME
        ? { executablePath: process.env.CHROME }
        : {}),
      ...(name === "firefox"
        ? {
            firefoxUserPrefs: {
              "ui.primaryPointerCapabilities": touch ? 1 : 2,
              "ui.allPointerCapabilities": touch ? 1 : 2,
            },
          }
        : {}),
    });
  }
  await launch(false);
  let context,
    page,
    touchContext = false;
  let metrics = { width: 1440, height: 900, mobile: false };
  async function viewport(next) {
    metrics = next;
    // Touch capability is a context setting. A fresh context is used only
    // between checks, before go(); never while inspecting expanded content.
    if (!context || touchContext !== next.mobile) {
      await context?.close();
      if (name === "firefox" && touchContext !== next.mobile) {
        await browser.close();
        await launch(next.mobile);
      }
      context = await browser.newContext({
        viewport: { width: next.width, height: next.height },
        ...(name !== "firefox"
          ? { hasTouch: next.mobile, isMobile: next.mobile }
          : {}),
      });
      touchContext = next.mobile;
      page = await context.newPage();
    } else
      await page.setViewportSize({ width: next.width, height: next.height });
  }
  try {
    await viewport(metrics);
  } catch (error) {
    await browser.close();
    throw error;
  }
  return {
    async send(method, params = {}) {
      switch (method) {
        case "Page.navigate":
          await page.goto(params.url, { waitUntil: "domcontentloaded" });
          break;
        case "Runtime.evaluate": {
          const value = await page.evaluate(params.expression);
          return { result: { result: { value } } };
        }
        case "Emulation.setDeviceMetricsOverride":
          await viewport({
            width: params.width,
            height: params.height,
            mobile: params.mobile,
          });
          break;
        case "Emulation.setTouchEmulationEnabled":
          break; // set by viewport
        case "Emulation.setEmulatedMedia":
          await page.emulateMedia({
            reducedMotion: params.features.some(
              (f) =>
                f.name === "prefers-reduced-motion" && f.value === "reduce",
            )
              ? "reduce"
              : "no-preference",
          });
          break;
        case "Input.dispatchKeyEvent": {
          if (params.type === "keyUp") {
            await page.keyboard.up(params.key === " " ? "Space" : params.key);
            if (params.modifiers === 8) await page.keyboard.up("Shift");
          } else {
            if (params.modifiers === 8) await page.keyboard.down("Shift");
            await page.keyboard.down(params.key === " " ? "Space" : params.key);
          }
          break;
        }
        default:
          throw new Error(`Unsupported browser command ${method}`);
      }
      return {};
    },
    async close() {
      await browser.close();
    },
  };
}
