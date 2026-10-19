// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// SLN-901 and SLN-902: the media manager asks before unsaved adjustments are
// lost, and the focus stays in it after Save and after a dialog over it closes
const api = vi.hoisted(() => ({ getImagePresentation: vi.fn(), saveImagePresentation: vi.fn() }));
vi.mock("@/lib/actions/image-adjustments", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ImageAdjustmentEditor, type DraftSave } from "@/components/media/image-adjustment-editor";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustment-css";
import { acquireSurface, restoreFocusOrigin } from "@/lib/ui/surface-state";

const SOURCE = "/api/s3/read?key=covers%2Fa.jpg";
const WRITTEN = "/api/s3/read?key=covers%2Fa-framed.jpg";
const presentation = (source: string) => ({
  source,
  preview: SOURCE,
  monochrome: false,
  settings: { ...DEFAULT_IMAGE_ADJUSTMENTS },
  crop: { cropX: 50, cropY: 50, cropZoom: 100, turn: 0, straighten: 0 },
  aspect: 2 / 3,
});
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

const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
const render = (source: string, onDraft: (save: DraftSave) => void, onSaved = vi.fn()) =>
  act(async () => root.render(createElement(ImageAdjustmentEditor, { source, onDraft, onSaved })));

describe("the manager's editor", () => {
  it("tells its owner when it holds unsaved work, and saves it on request", async () => {
    api.getImagePresentation.mockImplementation(async (source: string) => presentation(source));
    api.saveImagePresentation.mockResolvedValue({ assetKey: "covers/a-framed.jpg", sources: [WRITTEN], settings: { ...DEFAULT_IMAGE_ADJUSTMENTS }, monochrome: false });
    const onDraft = vi.fn();
    await render(SOURCE, onDraft);
    expect(onDraft).toHaveBeenLastCalledWith(null);
    await act(async () => button("Framing").click());
    await act(async () => button("Turn right").click());
    const save = onDraft.mock.calls.at(-1)![0] as () => Promise<boolean>;
    expect(save).toBeTypeOf("function");
    let saved = false;
    await act(async () => { saved = await save(); });
    expect(saved).toBe(true);
    expect(api.saveImagePresentation).toHaveBeenCalledWith(SOURCE, expect.objectContaining({ crop: expect.objectContaining({ turn: 90 }) }));
    expect(onDraft).toHaveBeenLastCalledWith(null);
  });

  it("stays open on its group when the owner hands back the file its save wrote", async () => {
    api.getImagePresentation.mockImplementation(async (source: string) => presentation(source));
    api.saveImagePresentation.mockResolvedValue({ assetKey: "covers/a-framed.jpg", sources: [WRITTEN], settings: { ...DEFAULT_IMAGE_ADJUSTMENTS }, monochrome: false });
    const onDraft = vi.fn();
    await render(SOURCE, onDraft);
    await act(async () => button("Framing").click());
    await act(async () => button("Turn right").click());
    const saveButton = button("Save");
    saveButton.focus();
    await act(async () => saveButton.click());
    // The list comes back with the new file as the image's source
    await render(WRITTEN, onDraft);
    expect(host.textContent).not.toContain("Loading image adjustments");
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe("Framing");
    // Save turned off once saved: the focus went to the group's first control, not the page
    expect(document.activeElement?.getAttribute("type")).toBe("range");
    expect(host.contains(document.activeElement)).toBe(true);
  });

  it("keeps Save focusable while it saves", async () => {
    api.getImagePresentation.mockImplementation(async (source: string) => presentation(source));
    let finish!: (value: unknown) => void;
    api.saveImagePresentation.mockReturnValue(new Promise((done) => { finish = done; }));
    await render(SOURCE, vi.fn());
    await act(async () => button("Framing").click());
    await act(async () => button("Turn right").click());
    await act(async () => button("Save").click());
    expect(button("Save").disabled).toBe(false);
    expect(button("Save").getAttribute("aria-busy")).toBe("true");
    expect(button("Save").closest("fieldset")).toBeNull();
    await act(async () => finish({ assetKey: "covers/a-framed.jpg", sources: [WRITTEN], settings: { ...DEFAULT_IMAGE_ADJUSTMENTS }, monochrome: false }));
  });
});

describe("a dialog over another one", () => {
  it("returns the focus to the control in the dialog under it that opened it", async () => {
    const under = document.createElement("dialog");
    under.setAttribute("open", "");
    const opener = document.createElement("button");
    under.append(opener);
    document.body.append(under);
    const manager = acquireSurface(() => {});
    opener.focus();
    const confirm = acquireSurface(() => {});
    (document.activeElement as HTMLElement | null)?.blur();
    confirm.release();
    restoreFocusOrigin({ target: opener, menuButton: null });
    expect(document.activeElement).toBe(opener);
    manager.release();
    under.remove();
  });

  it("leaves the focus where a newer surface or control put it", () => {
    const under = document.createElement("dialog");
    under.setAttribute("open", "");
    const opener = document.createElement("button");
    const other = document.createElement("input");
    under.append(opener, other);
    document.body.append(under);
    const manager = acquireSurface(() => {});
    other.focus();
    restoreFocusOrigin({ target: opener, menuButton: null });
    expect(document.activeElement).toBe(other);
    manager.release();
    under.remove();
  });
});

describe("the media manager", () => {
  const source = readFileSync(join(process.cwd(), "src/components/media/media-manager-dialog.tsx"), "utf8");
  it("asks before a close loses the editors' work", () => {
    expect(source).toContain("dirty={dirty}");
    expect(source).toContain("unlessUnsaved(() => handleTabChange(key))");
    expect(source).toContain("unlessUnsaved(() => void handleSetActive(item.id))");
  });

  it("keeps the active thumbnail focusable: pressed, it becomes the active one", () => {
    expect(source).not.toMatch(/disabled=\{isSettingThisActive \|\| \(item\.isActive/);
    expect(source).toContain("aria-disabled={(!isGallery && (item.isActive || !!settingActive)) || undefined}");
  });
});
