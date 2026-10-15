/** Shared native navigation assertions. All movement uses the reader's visible controls. */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitUI(driver, expression, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await driver.evaluate(expression);
    if (value) return value;
    await pause(25);
  }
  throw new Error("Navigation did not settle: " + expression.slice(0, 100));
}
export const readerPlace = `(() => {
  const location = document.querySelector("foliate-view")?.lastLocation;
  return { cfi: location?.cfi, index: location?.index, first: location?.range?.toString().replace(/\\s+/g, " ").trim().slice(0, 80),
    percent: document.querySelector('[role="slider"]')?.getAttribute("aria-valuenow"),
    footer: document.querySelector("footer[data-reader-chrome]")?.textContent ?? "" };
})()`;
export async function goto(driver, mode, text) {
  await driver.key("g", "KeyG");
  await waitUI(driver, "!!document.querySelector('dialog[open] input')");
  if (driver.selectMode) await driver.selectMode(mode);
  else await driver.evaluate(`(() => {
    const radio = [...document.querySelectorAll('dialog[open] [role="radio"]')].find(el => el.textContent === ${JSON.stringify(mode)});
    if (!radio) throw Error("Missing Go to mode");
    radio.click();
    document.querySelector('dialog[open] input').focus();
  })()`);
  await driver.fill(text);
  await driver.beforeCommit?.();
  if (driver.commit) await driver.commit();
  else await driver.key("Enter", "Enter");
  await waitUI(driver, "!document.querySelector('dialog[open]:not([data-reader-side-panel])')");
  return driver.evaluate(readerPlace);
}
/** Contents is open and holds the focus, so Escape reaches it */
const contentsOpen = (driver) => waitUI(driver, `(() => {
  const panel = document.querySelector("[data-reader-side-panel]");
  return !!panel?.open && panel.contains(document.activeElement);
})()`);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const pageValue = (label) => /^\d+$/.test(label) ? Number(label)
  : [...label.toLowerCase()].reduce((sum, digit, at, all) =>
    sum + (ROMAN[digit] < (ROMAN[all[at + 1]] ?? 0) ? -ROMAN[digit] : ROMAN[digit]), 0);
/** Whether the bottom bar's "p. 12" or "pp. 11–14" takes in the page `label` */
export function barShowsPage(footer, label) {
  const shown = footer.match(/pp?\.\s*(\d+|[ivxlcdm]+)(?:\s*[–-]\s*(\d+|[ivxlcdm]+))?/i);
  if (!shown) return false;
  const [, from, to = from] = shown;
  // Roman front matter and Arabic body pages are separate sequences
  if (/^\d+$/.test(from) !== /^\d+$/.test(label)) return false;
  const page = pageValue(label);
  return pageValue(from) <= page && page <= pageValue(to);
}
/** The bottom bar names the page. Where the screen holds several printed
 * pages (WebKit fits more on one) it names their range, "pp. x–xii" */
async function footerShows(driver, label, message) {
  const end = Date.now() + 5000;
  let place;
  do {
    place = await driver.evaluate(readerPlace);
    if (barShowsPage(place.footer, label)) return;
    await pause(50);
  } while (Date.now() < end);
  throw new Error(`${message}: the bottom bar reads "${place.footer}" at "${place.first}"`);
}
export async function checkNavigation(driver) {
  await driver.open(19);
  await goto(driver, "Page", "xii");
  await footerShows(driver, "xii", "EPUB 3 Roman page label missing");
  await goto(driver, "Page", "57");
  await footerShows(driver, "57", "EPUB 3 numeric page label missing");
  if (driver.savedPage) assert(await driver.savedPage("57"), "Saved locator lost pageLabel");
  await goto(driver, "Chapter", "Chapitre II");
  await driver.key("t", "KeyT");
  const selected = await waitUI(driver, 'document.querySelector(\'[aria-current="location"]\')?.textContent');
  assert(selected.includes("Chapitre II"), "Shared-spine chapter is not current");
  const panel = await driver.evaluate(`(() => {
    const panel = document.querySelector('[data-reader-side-panel]');
    return { modal: panel.matches(':modal'), expectedModal: innerWidth < 1024,
      width: panel.getBoundingClientRect().width, expectedWidth: innerWidth < 768 ? innerWidth : 360,
      overflow: getComputedStyle(panel).overflowY };
  })()`);
  assert(panel.modal === panel.expectedModal && Math.abs(panel.width - panel.expectedWidth) <= 0.5 && panel.overflow === "hidden",
    "Contents modality, drawer width or inner scrolling contract failed");
  await contentsOpen(driver);
  await driver.key("Escape", "Escape");
  await waitUI(driver, "!document.querySelector('[data-reader-side-panel]')");
  const text30 = await goto(driver, "Page", "30");
  await driver.evaluate(`(() => {
    const contents = document.querySelector("foliate-view").renderer.getContents();
    const link = contents.flatMap(({ doc }) => [...doc.querySelectorAll('a[href]')]).find(el => el.getAttribute("href").includes("notes.xhtml"));
    if (!link) throw Error("Missing notes link");
    link.click();
  })()`);
  await waitUI(driver, "document.querySelector('footer[data-reader-chrome]')?.textContent.includes('Outside the reading order')");
  const notes = await driver.evaluate(readerPlace);
  assert(notes.percent === text30.percent, "Nonlinear note changed reading progress");
  const last = await goto(driver, "Percent", "100%");
  assert(last.index === 1 && last.percent === "100", "100% did not reach final linear page");
  assert(await driver.evaluate("document.querySelector('foliate-view').renderer.atEnd"), "100% stopped at the start of the final chapter");
  await goto(driver, "Percent", "40");
  await driver.key("End", "End");
  await waitUI(driver, "document.querySelector('[role=slider]')?.getAttribute('aria-valuenow') === '100'");
  assert((await driver.evaluate(readerPlace)).index === 1, "End reached trailing notes");
  await driver.open(20);
  assert((await goto(driver, "Page", "57")).footer.includes("p. 57"), "Adobe page map fallback failed");
  await driver.open(21);
  await waitUI(driver, "document.querySelector('[data-reader-index]')?.getAttribute('data-reader-index') === 'ready'", 30000);
  await driver.key("t", "KeyT");
  // The panel renders its text a moment before it opens and takes the focus:
  // an Escape in between reaches the book, not the panel (WebKit)
  await contentsOpen(driver);
  const fallback = await waitUI(driver, "document.querySelector('[data-reader-side-panel]')?.textContent");
  assert(fallback.includes("Sections are listed in reading order") && fallback.includes("Préface") && !fallback.includes("Notes hors lecture"), "Fallback sections or heading labels failed");
  await driver.key("Escape", "Escape");
  await waitUI(driver, "!document.querySelector('[data-reader-side-panel]')");
  await driver.key("]", "BracketRight");
  await waitUI(driver, "document.querySelector('foliate-view')?.lastLocation?.index === 1");
  await driver.key("[", "BracketLeft");
  await waitUI(driver, "document.querySelector('foliate-view')?.lastLocation?.index === 0");
  await driver.open(driver.historyFixture ?? 17);
  await waitUI(driver, "!!document.querySelector('[data-reader=\"ready\"]')");
  const origin = await driver.evaluate(readerPlace);
  await goto(driver, "Percent", "70");
  const destination = await driver.evaluate(readerPlace);
  await driver.key("ArrowLeft", "ArrowLeft", 1);
  await waitUI(driver, "!!document.querySelector('[aria-label^=\"Forward to\"]')");
  const returned = await driver.evaluate(readerPlace);
  assert(returned.cfi === origin.cfi && returned.first === origin.first, "History Back did not restore the exact origin");
  await waitUI(driver, `[...document.querySelector("foliate-view").renderer.getContents()].some(({ overlayer }) => !!overlayer?.element?.querySelector('g[stroke]'))`);
  await driver.key("ArrowRight", "ArrowRight", 1);
  await waitUI(driver, `document.querySelector("foliate-view")?.lastLocation?.cfi === ${JSON.stringify(destination.cfi)} && document.querySelector('[aria-label^="Back to"]')?.disabled === false`);
  await driver.evaluate("document.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true })); document.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))");
  await waitUI(driver, `document.querySelector("foliate-view")?.lastLocation?.cfi === ${JSON.stringify(origin.cfi)} && document.querySelector('[aria-label^="Forward to"]')?.disabled === false`);
  assert(await driver.evaluate("!document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true }))") === false, "Browser Back was blocked at empty reader history");
  await goto(driver, "Percent", "10");
  const rapidOrigin = await driver.evaluate(readerPlace);
  await driver.key("ArrowRight", "ArrowRight");
  await waitUI(driver, `document.querySelector("foliate-view")?.lastLocation?.cfi !== ${JSON.stringify(rapidOrigin.cfi)}`);
  await pause(38);
  await driver.key("ArrowRight", "ArrowRight");
  await waitUI(driver, "document.querySelector('[aria-label^=\"Back to\"]')?.disabled === false");
  const rapid = await driver.evaluate(readerPlace);
  await goto(driver, "Percent", "10");
  const pacedOrigin = await driver.evaluate(readerPlace);
  await driver.key("ArrowRight", "ArrowRight");
  await waitUI(driver, `document.querySelector("foliate-view")?.lastLocation?.cfi !== ${JSON.stringify(pacedOrigin.cfi)} && document.querySelector('[aria-label^="Back to"]')?.disabled === false`);
  const pacedFirst = await driver.evaluate(readerPlace);
  await driver.key("ArrowRight", "ArrowRight");
  await waitUI(driver, `document.querySelector("foliate-view")?.lastLocation?.cfi !== ${JSON.stringify(pacedFirst.cfi)} && document.querySelector('[aria-label^="Back to"]')?.disabled === false`);
  const paced = await driver.evaluate(readerPlace);
  assert(rapid.cfi === paced.cfi && rapid.first === paced.first && rapid.percent === paced.percent,
    "An ordinary turn during the previous transition or paint was lost");
}
/** A jump over a section that is not loaded keeps no page across the gap: one
 * back turn after Chapter 2 then Chapter 4 ends Chapter 3, not Chapter 2
 * (SLN-673). Needs the large fixture 14, 30 chapters of eight pages. */
export async function checkJumpBack(driver) {
  await driver.open(14);
  await waitUI(driver, "!!document.querySelector('[data-reader=\"ready\"]')", 30000);
  for (const [from, to] of [["Chapter 2", "Chapter 4"], ["Chapter 4", "Chapter 6"]]) {
    await goto(driver, "Chapter", from);
    await pause(2500);
    const jumped = await goto(driver, "Chapter", to);
    await pause(2500);
    await driver.key("ArrowLeft", "ArrowLeft");
    await waitUI(driver, `document.querySelector("foliate-view")?.lastLocation?.index !== ${jumped.index}`);
    const back = await driver.evaluate(readerPlace);
    assert(back.index === jumped.index - 1, `A back turn from ${to} went to section ${back.index}, not the one before`);
  }
}
