// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-1461: a gallery drop sent every photo at once, with no Cancel and no
// leave warning, and a reload lost the photos not yet sent
const upload = vi.hoisted(() => ({ uploadMediaFile: vi.fn(), mediaResponseError: vi.fn() }));
vi.mock("@/lib/utils/media-upload", () => upload);
import { UploadZone } from "@/components/media/upload-zone";
import { createUploadQueue, UPLOADS_AT_ONCE } from "@/lib/utils/upload-queue";

let root: Root;
let host: HTMLElement;
let pending: { resolve: () => void; reject: (error: Error) => void }[];
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.resetAllMocks();
  pending = [];
  upload.uploadMediaFile.mockImplementation(
    () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  // Let anything still waiting finish, so no leave warning outlives its test
  for (let i = 0; i < 20 && pending.length > 0; i++) await act(async () => pending.shift()!.resolve());
  act(() => root.unmount());
  host.remove();
});

const photos = (count: number) =>
  Array.from({ length: count }, (_, i) => new File(["x"], `photo-${i + 1}.jpg`, { type: "image/jpeg" }));
async function drop(files: File[]) {
  const button = host.querySelector("button")!;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, getData: () => "" } });
  await act(async () => button.dispatchEvent(event));
}
const gallery = (onUploadComplete = vi.fn()) =>
  act(async () =>
    root.render(createElement(UploadZone, {
      entityType: "work", entityId: "00000000-0000-4000-8000-000000000001", mediaType: "gallery", multiple: true, onUploadComplete,
    })),
  );
async function finishNext() {
  await act(async () => pending.shift()!.resolve());
}
const leaveIsAsked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const button = (name: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name);

describe("a gallery drop (SLN-1461)", () => {
  it("sends a few photos at a time, the next one as each finishes", async () => {
    await gallery();
    await drop(photos(6));
    expect(UPLOADS_AT_ONCE).toBe(2);
    expect(upload.uploadMediaFile).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("2 sending, 4 waiting");
    await finishNext();
    expect(upload.uploadMediaFile).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 5; i++) await finishNext();
    expect(upload.uploadMediaFile).toHaveBeenCalledTimes(6);
    expect(host.textContent).not.toContain("waiting");
  });

  it("asks before leaving while photos are waiting or sending, and not after", async () => {
    await gallery();
    expect(leaveIsAsked()).toBe(false);
    await drop(photos(3));
    expect(leaveIsAsked()).toBe(true);
    for (let i = 0; i < 3; i++) await finishNext();
    expect(leaveIsAsked()).toBe(false);
  });

  it("Cancel keeps the photos already sent or sending, and says how many were added", async () => {
    const complete = vi.fn();
    await gallery(complete);
    await drop(photos(30));
    for (let i = 0; i < 6; i++) await finishNext();
    await act(async () => button("Cancel")!.click());
    expect(host.textContent).toContain("Cancelled. Finishing the 2 images already sending…");
    expect(button("Cancel")).toBeUndefined();
    await finishNext();
    await finishNext();
    expect(upload.uploadMediaFile).toHaveBeenCalledTimes(8);
    expect(complete).toHaveBeenCalledTimes(8);
    expect(host.textContent).toContain("Cancelled. 8 images added, 22 not sent.");
    expect(host.textContent).not.toContain("Waiting");
    expect(leaveIsAsked()).toBe(false);
  });

  it("a failed photo says why, and the rest still go", async () => {
    await gallery();
    await drop(photos(3));
    await act(async () => pending.shift()!.reject(new Error("This file is not an image Durtal can read.")));
    expect(host.textContent).toContain("This file is not an image Durtal can read.");
    expect(upload.uploadMediaFile).toHaveBeenCalledTimes(3);
  });

  it("a new drop after a cancelled one counts afresh", async () => {
    await gallery();
    await drop(photos(4));
    await act(async () => button("Cancel")!.click());
    await finishNext();
    await finishNext();
    expect(host.textContent).toContain("Cancelled. 2 images added, 2 not sent.");
    await drop(photos(1));
    expect(host.textContent).not.toContain("Cancelled");
  });
});

describe("the upload queue", () => {
  it("keeps sending, and asking before leaving, after the drop zone closes", async () => {
    const queue = createUploadQueue(1);
    const done: string[] = [];
    let release!: () => void;
    queue.add("a", () => new Promise<void>((resolve) => { release = resolve; }).then(() => { done.push("a"); }));
    queue.add("b", async () => { done.push("b"); });
    expect(leaveIsAsked()).toBe(true);
    release();
    await vi.waitFor(() => expect(done).toEqual(["a", "b"]));
    expect(leaveIsAsked()).toBe(false);
  });

  it("cancel returns what was waiting, and a failed upload never stops the queue", async () => {
    const queue = createUploadQueue(1);
    let release!: () => void;
    queue.add("a", () => new Promise<void>((_, reject) => { release = () => reject(new Error("refused")); }));
    const ran = vi.fn(async () => {});
    queue.add("b", ran);
    queue.add("c", ran);
    expect(queue.cancel()).toEqual(["b", "c"]);
    queue.add("d", ran);
    release();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(leaveIsAsked()).toBe(false));
  });
});
