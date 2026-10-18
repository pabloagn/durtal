// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SLN-903 to SLN-906, from the media editor survey: uploads are checked
// before they are sent, the drop zone takes the keyboard, the image tabs say
// which is chosen, and the manager's words match the editor's
const upload = vi.hoisted(() => ({ uploadMediaFile: vi.fn(), mediaResponseError: vi.fn() }));
vi.mock("@/lib/utils/media-upload", () => upload);
import { UploadZone } from "@/components/media/upload-zone";
import { IMAGE_ACCEPT, imageFileRefusal, MAX_MEDIA_SIZE_BYTES } from "@/lib/validations/media-security";
import { acquireSurface, captureFocusOrigin } from "@/lib/ui/surface-state";

let root: Root;
let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const file = (name: string, type: string, size: number) => {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
};
async function choose(chosen: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [chosen], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
const zone = () => act(async () => root.render(createElement(UploadZone, { entityType: "work", entityId: "00000000-0000-4000-8000-000000000001", mediaType: "poster" })));

describe("an image upload", () => {
  it("says a file is too large, or of a type the server refuses, before sending anything", async () => {
    await zone();
    await choose(file("huge.png", "image/png", 58 * 1024 * 1024));
    expect(host.textContent).toContain("File too large. Maximum size: 50 MB.");
    await choose(file("scan.tiff", "image/tiff", 1000));
    expect(host.textContent).toContain("File type not allowed. Accepted: JPEG, PNG, WebP, GIF.");
    expect(upload.uploadMediaFile).not.toHaveBeenCalled();
  });

  it("sends a file within the limits", async () => {
    upload.uploadMediaFile.mockResolvedValue(undefined);
    await zone();
    await choose(file("poster.png", "image/png", MAX_MEDIA_SIZE_BYTES));
    expect(upload.uploadMediaFile).toHaveBeenCalledTimes(1);
  });

  it("offers only the four types in the file picker", async () => {
    await zone();
    expect(host.querySelector<HTMLInputElement>('input[type="file"]')!.accept).toBe("image/jpeg,image/png,image/webp,image/gif");
    expect(IMAGE_ACCEPT).toBe("image/jpeg,image/png,image/webp,image/gif");
    expect(imageFileRefusal({ size: 10, type: "image/webp" })).toBeNull();
  });

  it("opens the file picker from the keyboard: the drop zone is a button", async () => {
    await zone();
    const button = host.querySelector("button")!;
    expect(button.textContent).toContain("Drop poster image here");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picked = vi.spyOn(input, "click");
    await act(async () => button.click());
    expect(picked).toHaveBeenCalled();
  });
});

describe("a file that is not an image", () => {
  it("is refused with a reason", async () => {
    vi.doUnmock("@/lib/utils/media-upload");
    const { readableImage, MediaIngestError } = await import("@/lib/media/ingest");
    await expect(readableImage(Buffer.from("this is text, named .jpg"))).rejects.toThrow(MediaIngestError);
    await expect(readableImage(Buffer.from("this is text, named .jpg"))).rejects.toThrow("This file is not an image Durtal can read.");
  });
});

describe("the media manager", () => {
  const source = readFileSync(join(process.cwd(), "src/components/media/media-manager-dialog.tsx"), "utf8");
  const painting = readFileSync(join(process.cwd(), "src/components/paintings/painting-actions.tsx"), "utf8");

  it("says which image tab is chosen", () => {
    expect(source).toContain('ariaLabel="Images"');
    expect(source).toMatch(/<SegmentedControl\s+options=\{tabs\.map/);
  });

  it("speaks as the editor does, and writes sizes with ×", () => {
    expect(source).not.toMatch(/Failed to/);
    expect(source).not.toContain('"Media deleted"');
    expect(source).toContain("{item.width}×{item.height}");
  });

  it("calls a painting's main image an image", () => {
    expect(painting).toContain('mainImage="image"');
    expect(source).toContain('{ ...tab, label: "Image" }');
  });
});

// The review of #459 (findings/review-pr-459.md, notes 1 and 2)
describe("after the review of the media manager", () => {
  it("opens a dialog from what was just pressed, not from the layer that closed a moment before", () => {
    const dialog = document.createElement("dialog");
    const done = document.createElement("button");
    const del = document.createElement("button");
    dialog.append(done, del);
    document.body.append(dialog);
    done.focus();
    // "Unsaved changes" opens from Done, and Keep editing closes it
    const prompt = acquireSurface(() => {}, captureFocusOrigin());
    prompt.release();
    // Delete image pressed within the same frame, before the hand-over clears
    del.focus();
    expect(captureFocusOrigin()?.target).toBe(del);
    dialog.remove();
  });

  it("names each poster thumbnail by its place and whether it is shown", () => {
    const source = readFileSync(join(__dirname, "../../components/media/media-manager-dialog.tsx"), "utf8");
    expect(source).toContain("${index + 1} of ${items.length}${item.isActive ? \", active\" : \"\"}");
  });
});
