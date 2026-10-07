// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { resolveObjectURL } from "node:buffer";
import { DEFER_IMAGE_BYTES, DeferredImages } from "@/lib/reader/engines/foliate/deferred-images";
import type { ZipLoader } from "@/lib/reader/engines/foliate/foliate";

/* SLN-492: a reflowable EPUB's large images are blanks of their size until the text is shown */

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

function loader(sizes: Record<string, number>, heads: Record<string, Uint8Array | undefined>) {
  return {
    entries: [],
    getSize: (name: string) => sizes[name] ?? 0,
    readHead: vi.fn(async (name: string) => heads[name]),
    loadBlob: vi.fn(async (name: string, type?: string) => new Blob([`bytes of ${name}`], { type })),
  } as unknown as ZipLoader & { readHead: ReturnType<typeof vi.fn>; loadBlob: ReturnType<typeof vi.fn> };
}

/** What foliate-js's loader asks before it loads a resource */
async function ask(target: EventTarget, href: string, type: string) {
  const detail: { type: string; href: string; allow: boolean; url?: Promise<string> } = { type, href, allow: true };
  target.dispatchEvent(new CustomEvent("load", { detail }));
  return detail.url ? await detail.url : undefined;
}

/** What an object URL holds (happy-dom's fetch cannot read blob: URLs) */
const textOf = async (url: string) => (await resolveObjectURL(url)!.text()) as string;

describe("DeferredImages", () => {
  it("leaves small images, other types and unknown sizes to foliate-js", async () => {
    const zip = loader({ "small.png": DEFER_IMAGE_BYTES - 1, "plate.svg": 10 * DEFER_IMAGE_BYTES }, {});
    const target = new EventTarget();
    new DeferredImages(zip).attach(target);
    expect(await ask(target, "small.png", "image/png")).toBeUndefined();
    expect(await ask(target, "plate.svg", "image/svg+xml")).toBeUndefined();
    expect(await ask(target, "chapter.xhtml", "application/xhtml+xml")).toBeUndefined();
    expect(zip.readHead).not.toHaveBeenCalled();
  });

  it("answers a large image with a blank of its size, then fills it in once the section loads", async () => {
    const zip = loader({ "plate.png": 10 * 1024 * 1024 }, { "plate.png": png(1600, 2400) });
    const target = new EventTarget();
    const images = new DeferredImages(zip);
    images.attach(target);
    const blank = (await ask(target, "plate.png", "image/png"))!;
    expect(blank).toMatch(/^blob:/);
    expect(await textOf(blank)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400" viewBox="0 0 1600 2400"/>');
    expect(zip.loadBlob).not.toHaveBeenCalled();

    const doc = document.implementation.createHTMLDocument("section");
    doc.body.innerHTML = `<p><img id="a" src="${blank}"></p><svg xmlns="http://www.w3.org/2000/svg"><image id="b" href="${blank}"/></svg><img id="c" src="other.png">`;
    images.fill(doc);
    await vi.waitFor(() => expect(doc.getElementById("a")!.getAttribute("src")).not.toBe(blank));
    await vi.waitFor(() => expect(doc.getElementById("b")!.getAttribute("href")).not.toBe(blank));
    expect(await textOf(doc.getElementById("a")!.getAttribute("src")!)).toBe("bytes of plate.png");
    expect(doc.getElementById("c")!.getAttribute("src")).toBe("other.png");
    expect(zip.loadBlob).toHaveBeenCalledWith("plate.png", "image/png");
    images.destroy();
  });

  it("fills an xlink:href too", async () => {
    const zip = loader({ "cover.jpg": DEFER_IMAGE_BYTES }, { "cover.jpg": png(10, 20) });
    const target = new EventTarget();
    const images = new DeferredImages(zip);
    images.attach(target);
    const blank = (await ask(target, "cover.jpg", "image/jpeg"))!;
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="${blank}"/></svg>`,
      "image/svg+xml",
    );
    images.fill(doc);
    const image = doc.querySelector("image")!;
    await vi.waitFor(() => expect(image.getAttributeNS("http://www.w3.org/1999/xlink", "href")).not.toBe(blank));
  });

  it("loads the image itself when its size cannot be read", async () => {
    const zip = loader({ "odd.png": 10 * DEFER_IMAGE_BYTES }, { "odd.png": new Uint8Array([1, 2, 3]) });
    const target = new EventTarget();
    new DeferredImages(zip).attach(target);
    const url = (await ask(target, "odd.png", "image/png"))!;
    expect(await textOf(url)).toBe("bytes of odd.png");
  });

  it("does not fill a section that went away first, and frees what it filled when it goes", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const zip = loader({ "plate.png": 10 * DEFER_IMAGE_BYTES }, { "plate.png": png(100, 100) });
    const target = new EventTarget();
    const images = new DeferredImages(zip);
    images.attach(target);
    const blank = (await ask(target, "plate.png", "image/png"))!;

    const frame = document.createElement("iframe");
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = `<img src="${blank}">`;
    images.fill(doc);
    await vi.waitFor(() => expect(doc.querySelector("img")!.getAttribute("src")).not.toBe(blank));
    const filled = doc.querySelector("img")!.getAttribute("src")!;
    frame.contentWindow!.dispatchEvent(new Event("pagehide"));
    expect(revoke).toHaveBeenCalledWith(filled);

    let release: (blob: Blob) => void = () => {};
    zip.loadBlob.mockImplementationOnce(() => new Promise<Blob>((resolve) => (release = resolve)));
    const later = document.createElement("iframe");
    document.body.append(later);
    later.contentDocument!.body.innerHTML = `<img src="${blank}">`;
    images.fill(later.contentDocument!);
    later.contentWindow!.dispatchEvent(new Event("pagehide"));
    release(new Blob(["late"]));
    await vi.waitFor(() => expect(revoke.mock.calls.length).toBeGreaterThan(1));
    expect(later.contentDocument!.querySelector("img")!.getAttribute("src")).toBe(blank);
    revoke.mockRestore();
  });
});
