#!/usr/bin/env node
// Native proof of production adapters. Run only under a root-granted heavy slot.
// No DB writes; the fixture route is temporary. Reports stay local.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
if (!args.includes("--heavy-granted"))
  throw new Error(
    "Root heavy-slot grant and verified lock required; source preparation is safe without running this script",
  );
const base = option("--base", "http://127.0.0.1:3464"),
  url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port === "3100")
  throw new Error("Disposable loopback preview only");
const out = resolve(option("--out", "/tmp/sln-333-native-proof"));
mkdirSync(out, { recursive: true });
const manifest = JSON.parse(
  readFileSync("src/__tests__/fixtures/image-rotation/manifest.json"),
);
for (const [file, expected] of Object.entries(manifest.images)) {
  const bytes = readFileSync(`src/__tests__/fixtures/image-rotation/${file}`);
  if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256)
    throw new Error(`Fixture hash changed: ${file}`);
  const served = await fetch(
    new URL(`/qa/image-rotation-fixtures/${file}`, base),
  );
  if (
    !served.ok ||
    createHash("sha256")
      .update(Buffer.from(await served.arrayBuffer()))
      .digest("hex") !== expected.sha256
  )
    throw new Error(`Served fixture mismatch: ${file}`);
}
const playwright = await import(
  process.env.PLAYWRIGHT_CORE
    ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href
    : "playwright-core"
);
const sharp = (await import("sharp")).default;
const results = [],
  failures = [];
const consumers = [
  "preview",
  "plain",
  "next",
  "media-lightbox",
  "shared-lightbox",
];
const scenarios = [
  "neutral",
  "explicit",
  "recrop",
  "reset-crop",
  "legacy",
  "portrait",
];
const record = (name, error) => {
  results.push({ name, passed: !error, error: error?.message });
  if (error) failures.push(name);
  console.log(
    `${error ? "FAIL" : "ok"} ${name}${error ? `: ${error.message}` : ""}`,
  );
};
const change = async (page, state) =>
  page.evaluate(
    (detail) =>
      window.dispatchEvent(
        new CustomEvent("rotation-proof:change", { detail }),
      ),
    state,
  );
async function waitLoaded(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("img")].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await page.evaluate(() =>
    Promise.all([...document.images].map((img) => img.decode())),
  );
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime),
        )
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
}
async function geometry(page) {
  return page
    .locator("[data-image-rotation-frame]")
    .last()
    .evaluate((frame) => {
      const layer = frame.querySelector("[data-image-rotation-selection]"),
        image = layer.querySelector("img");
      const f = frame.getBoundingClientRect(),
        b = layer.getBoundingClientRect();
      const layerCSS = getComputedStyle(layer),
        imageCSS = image && getComputedStyle(image);
      return {
        frame: { left: f.left, top: f.top, width: f.width, height: f.height },
        bounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
        width: parseFloat(getComputedStyle(frame).width),
        height: parseFloat(getComputedStyle(frame).height),
        visible: layerCSS.visibility,
        transform: layerCSS.transform,
        image: image
          ? {
              src: image.src,
              width: image.naturalWidth,
              height: image.naturalHeight,
              left: parseFloat(imageCSS.left),
              top: parseFloat(imageCSS.top),
              renderWidth: parseFloat(imageCSS.width),
              renderHeight: parseFloat(imageCSS.height),
              transform: imageCSS.transform,
            }
          : null,
        selectedWidth: parseFloat(layerCSS.width),
        selectedHeight: parseFloat(layerCSS.height),
      };
    });
}
for (const engine of ["chrome", "firefox", "webkit"]) {
  const launcher =
    engine === "chrome" ? playwright.chromium : playwright[engine];
  const browser = await launcher.launch({
    headless: true,
    ...(engine === "chrome" ? { channel: "chrome" } : {}),
  });
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.goto(new URL("/qa/image-rotation", base).href);
      await page.waitForSelector("[data-rotation-proof]");
      for (const consumer of consumers)
        for (const scenario of scenarios)
          for (const rotation of [0, 45, 90, 0]) {
            const name = `${engine}-${viewport.width}-${consumer}-${scenario}-${rotation}-${results.length}`;
            try {
              await change(page, {
                consumer,
                scenario,
                rotation,
                broken: false,
                transformed: false,
                version: 0,
                open: consumer.endsWith("lightbox"),
              });
              await waitLoaded(page);
              if (rotation === 0) {
                if (await page.locator("[data-image-rotation-frame]").count())
                  throw new Error("Zero path created a frame");
              } else {
                const g = await geometry(page),
                  f = g.frame,
                  b = g.bounds;
                if (
                  g.visible !== "visible" ||
                  b.left < f.left - 0.5 ||
                  b.top < f.top - 0.5 ||
                  b.right > f.left + f.width + 0.5 ||
                  b.bottom > f.top + f.height + 0.5
                )
                  throw new Error("Rotated bounds lost selected pixels");
                if (
                  Math.abs(
                    g.image.renderWidth / g.image.renderHeight -
                      g.image.width / g.image.height,
                  ) > 1e-5 ||
                  g.image.transform !== "none"
                )
                  throw new Error("Image stretched or transformed twice");
                const file = new URL(g.image.src).pathname.split("/").pop();
                const points =
                  consumer === "preview" && scenario === "recrop"
                    ? manifest.pendingMarkers
                    : manifest.images[file].markers;
                const shot = await page.screenshot({
                  path: resolve(out, `${name}.png`),
                });
                const { data, info } = await sharp(shot)
                  .removeAlpha()
                  .raw()
                  .toBuffer({ resolveWithObject: true });
                const angle = (rotation * Math.PI) / 180,
                  scale = g.image.renderWidth / g.image.width;
                for (const [x, y] of points) {
                  const dx = g.image.left + x * scale - g.selectedWidth / 2,
                    dy = g.image.top + y * scale - g.selectedHeight / 2;
                  const px = Math.round(
                    f.left +
                      f.width / 2 +
                      ((dx * Math.cos(angle) - dy * Math.sin(angle)) *
                        f.width) /
                        g.width,
                  );
                  const py = Math.round(
                    f.top +
                      f.height / 2 +
                      ((dx * Math.sin(angle) + dy * Math.cos(angle)) *
                        f.height) /
                        g.height,
                  );
                  let white = false;
                  for (let yy = py - 1; yy <= py + 1; yy++)
                    for (let xx = px - 1; xx <= px + 1; xx++) {
                      if (
                        xx < 0 ||
                        yy < 0 ||
                        xx >= info.width ||
                        yy >= info.height
                      )
                        continue;
                      const offset = (yy * info.width + xx) * info.channels;
                      if (
                        data[offset] > 220 &&
                        data[offset + 1] > 220 &&
                        data[offset + 2] > 220
                      )
                        white = true;
                    }
                  if (!white)
                    throw new Error(
                      `Missing native corner marker at ${px},${py}`,
                    );
                }
              }
              record(name);
            } catch (error) {
              record(name, error);
            }
          }
      for (const consumer of consumers) {
        const name = `${engine}-${viewport.width}-${consumer}-failure-recovery`;
        try {
          await change(page, {
            consumer,
            scenario: "neutral",
            rotation: 45,
            broken: true,
            open: consumer.endsWith("lightbox"),
          });
          await page.waitForFunction(() =>
            [...document.images].every((img) => img.complete),
          );
          await page.waitForFunction(() =>
            [
              ...document.querySelectorAll("[data-image-rotation-selection]"),
            ].every(
              (layer) => getComputedStyle(layer).visibility === "visible",
            ),
          );
          let g = await geometry(page);
          if (
            g.transform !== "none" ||
            g.frame.width <= 0 ||
            g.frame.height <= 0
          )
            throw new Error("Error UI has no finite unrotated frame");
          await page.screenshot({ path: resolve(out, `${name}-error.png`) });
          // Reopen the already-failed URL to cover browser-cached failure.
          await change(page, { open: false });
          await change(page, { open: consumer.endsWith("lightbox") });
          await page.waitForFunction(() =>
            [
              ...document.querySelectorAll("[data-image-rotation-selection]"),
            ].every(
              (layer) => getComputedStyle(layer).visibility === "visible",
            ),
          );
          if (!consumer.endsWith("lightbox"))
            await page.getByRole("button", { name: "Retry image" }).click();
          else await change(page, { broken: false });
          await waitLoaded(page);
          g = await geometry(page);
          if (g.transform === "none" || !g.image.width)
            throw new Error(
              "Retry/source replacement did not recover rotation",
            );
          if (consumer === "media-lightbox") {
            await page
              .getByRole("button", { name: "Next image", exact: true })
              .click();
            await waitLoaded(page);
            g = await geometry(page);
            if (g.image.width !== 600 || g.image.height !== 1200)
              throw new Error(
                "Actual lightbox navigation retained old intrinsic dimensions",
              );
            await page
              .getByRole("button", { name: "Previous image", exact: true })
              .click();
            await waitLoaded(page);
          }
          // Hold a fresh native request; loading must not flash clipped pixels.
          const version = 1000 + results.length,
            pattern = `**/landscape.png?v=${version}`;
          let release;
          const held = new Promise((resolve) => {
            release = resolve;
          });
          const handler = async (route) => {
            await held;
            await route.continue();
          };
          await page.route(pattern, handler);
          try {
            const requested = page.waitForRequest((request) =>
              request.url().endsWith(`/landscape.png?v=${version}`),
            );
            await change(page, { scenario: "neutral", broken: false, version });
            await requested;
            if ((await geometry(page)).visible !== "hidden")
              throw new Error("Pending native image flashed before decoding");
          } finally {
            release();
            await page.unroute(pattern, handler);
          }
          await waitLoaded(page);
          await page.setViewportSize({
            width: viewport.width - 30,
            height: viewport.height - 60,
          });
          await waitLoaded(page);
          await change(page, {
            open: false,
            consumer: "preview",
            transformed: true,
          });
          if (
            (await page
              .locator("[data-proof-parent]")
              .evaluate((el) => getComputedStyle(el).transform)) === "none"
          )
            throw new Error("Parent transform lost");
          record(name);
        } catch (error) {
          record(name, error);
        }
      }
      for (const file of ["alignment-audit.js", "overflow-audit.js"]) {
        const value = await page.evaluate(
          readFileSync(`scripts/qa/${file}`, "utf8"),
        );
        writeFileSync(
          resolve(out, `${engine}-${viewport.width}-${file}.json`),
          JSON.stringify(value, null, 2),
        );
        if (
          value?.issues?.length ||
          value?.overflow > 0.5 ||
          value?.offenders?.length
        )
          record(
            `${engine}-${viewport.width}-${file}`,
            new Error("Native alignment/overflow audit has findings"),
          );
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
writeFileSync(
  resolve(out, "results.json"),
  JSON.stringify({ fixtures: manifest, results, failures }, null, 2),
);
if (failures.length) process.exitCode = 1;
