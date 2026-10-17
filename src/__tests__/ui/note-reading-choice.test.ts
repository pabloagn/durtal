// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReadingChoice, ReadingChoicePage } from "@/lib/reading/overview-types";
import { emptyReadingSummary } from "@/lib/reading/overview-types";
import type { ReadingDialogProps } from "@/components/reading/reading-dialog-types";
const actions = vi.hoisted(()=>({ getReadingChoicePage:vi.fn(),getReadingChoice:vi.fn(),createReadingNote:vi.fn(),updateReadingNote:vi.fn() }));
vi.mock("@/lib/actions/reading",()=>actions);
vi.mock("@/lib/actions/reading-notes",()=>actions);
vi.mock("@/lib/notifications/toast",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
import { FeatureSurface } from "@/components/ui/feature-renderer";
import { hasOpenSurface } from "@/lib/ui/surface-state";
import { NoteDialog } from "@/components/reading/dialogs/note-dialog";
let host:HTMLElement,root:Root;
const choice = (n:number):ReadingChoice=>({id:`r${n}`,ordinal:n,status:"finished",editionId:"e2",editionLabel:"Old edition",unit:"pages",currentPage:42,currentPercent:20,currentChapter:"Old chapter",startedOn:null,startedPrecision:"unknown",finishedOn:null,finishedPrecision:"unknown"});
const page = (items:ReadingChoice[],n=1):ReadingChoicePage=>({items,page:n,total:100,hasNext:n<5});
const recent = Array.from({length:20},(_,i)=>choice(100-i));
const props = ():ReadingDialogProps=>({data:{workId:"w",workTitle:"Private fixture",bookRating:null,dayStartHour:4,rows:[],summary:{...emptyReadingSummary(),readingCount:100,finishedCount:100},defaults:{lastEditionId:"e1",latestMinutesByEdition:{}},history:{closedCount:100,hasMore:true},editions:[{id:"e1",title:"First",label:"First",short:"First",pageCount:300,language:"en",translators:[],cover:null,owned:false,copies:[]},{id:"e2",title:"Second",label:"Second",short:"Second",pageCount:200,language:"en",translators:[],cover:null,owned:false,copies:[]}],homes:[],today:"2026-10-17",zone:"Europe/Amsterdam"},row:null,request:{kind:"note",noteKind:"note",readingId:"r42"},home:null,setHome:()=>{},onClose:vi.fn(),changed:vi.fn(),open:vi.fn()});
beforeAll(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;window.matchMedia=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};});
beforeEach(()=>{actions.getReadingChoicePage.mockReset().mockResolvedValue(page(recent));actions.getReadingChoice.mockReset().mockResolvedValue(choice(42));host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const flush=()=>act(async()=>{await Promise.resolve();await Promise.resolve();});
const click=(text:string)=>act(()=>{const button=[...document.querySelectorAll("button")].findLast(button=>button.textContent?.trim()===text);expect(button).toBeTruthy();button!.click();});
function dialogNamed(title: string): HTMLDialogElement {
  const dialog = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].find(dialog => {
    const label = dialog.getAttribute("aria-label") ?? (dialog.getAttribute("aria-labelledby") ?? "").split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ");
    return label.trim() === title;
  });
  expect(dialog, `Open dialog named ${title}`).toBeTruthy();
  return dialog!;
}
function cancelChooser() {
  const button = [...dialogNamed("Choose a reading").querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Cancel");
  expect(button).toBeTruthy();
  act(() => button!.click());
}

function write(label: string, value: string) {
  const node = [...document.querySelectorAll("label")].find(node => node.textContent === label)!;
  const input = document.getElementById(node.htmlFor);
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement))
    throw new Error(`Expected an input or textarea for ${label}`);
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

it("keeps a selected off-page read alongside twenty choices with its true ordinal",async()=>{act(()=>root.render(h(NoteDialog,props())));await flush();const label=[...document.querySelectorAll("label")].find(node=>node.textContent==="Reading")!;act(()=>(document.getElementById(label.htmlFor) as HTMLElement).click());expect(document.querySelectorAll('[role="option"]')).toHaveLength(22);expect(document.body.textContent).toContain("42nd read");expect(actions.getReadingChoice).toHaveBeenCalledWith("w","r42");});
it("discards late search results and preserves manual edition, passage and Roman pages",async()=>{act(()=>root.render(h(NoteDialog,props())));await flush();const body=write("Note","Private words remain here");write("Page","xiv");const editionLabel=[...document.querySelectorAll("label")].find(node=>node.textContent==="Edition")!;act(()=>(document.getElementById(editionLabel.htmlFor) as HTMLElement).click());act(()=>([...document.querySelectorAll('[role="option"]')].find(node=>node.textContent?.includes("First")) as HTMLElement).click());click("Choose an older reading");await flush();let old!:(page:ReadingChoicePage)=>void;let latest!:(page:ReadingChoicePage)=>void;actions.getReadingChoicePage.mockImplementationOnce(()=>new Promise<ReadingChoicePage>(resolve=>{old=resolve;})).mockImplementationOnce(()=>new Promise<ReadingChoicePage>(resolve=>{latest=resolve;}));write("Search readings","older");click("Search");await flush();write("Search readings","latest");click("Search");await flush();await act(async()=>latest(page([choice(7)])));await act(async()=>old(page([choice(9)])));expect(document.body.textContent).toContain("7th read");expect(document.body.textContent).not.toContain("9th read");click("7th read · Second · finished");expect(body.value).toBe("Private words remain here");const position=document.querySelector<HTMLInputElement>('[data-note-position]')!;expect(position.value).toBe("xiv");expect(document.getElementById(editionLabel.htmlFor)?.textContent).toContain("First");});
it("offers retry after a failed page and cancel returns to the unchanged note",async()=>{act(()=>root.render(h(NoteDialog,props())));await flush();const body=write("Note","Draft");actions.getReadingChoicePage.mockRejectedValueOnce(new Error("offline"));click("Choose an older reading");await flush();expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not load");actions.getReadingChoicePage.mockResolvedValueOnce(page([choice(12)]));click("Retry");await flush();expect(document.body.textContent).toContain("12th read");cancelChooser();expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);expect(body.value).toBe("Draft");});


// The hub/journal host supplies a real shared lease to the outer NoteDialog.
// This is intentionally not a standalone Dialog: children must reset that
// inherited scope before acquiring their own nested surface.
function SharedNoteHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => { onClose(); setOpen(false); };
  return open ? h(FeatureSurface, { close, children: h(NoteDialog, { ...props(), onClose: close }) }) : h("p", null, "Note closed");
}

it.each(["Escape", "Cancel", "selection"])("closes only the nested chooser and restores its pointer opener after %s", async method => {
  const close = vi.fn();
  act(() => root.render(h(SharedNoteHost, { onClose: close })));
  await flush();
  const body = write("Note", "Keep this private draft");
  write("Page", "xiv");
  const opener = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Choose an older reading")!;
  // Reproduce Safari pointer activation, which starts without button focus.
  act(() => (document.activeElement as HTMLElement).blur());
  expect(document.activeElement).toBe(document.body);
  act(() => opener.click());
  await flush();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(2);
  if (method === "Escape") {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => document.activeElement!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  } else if (method === "Cancel") cancelChooser();
  else click("100th read · Second · finished");
  await flush();
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  expect(document.body.textContent).not.toContain("Unsaved changes");
  expect(document.activeElement).toBe(opener);
  expect(body.value).toBe("Keep this private draft");
  expect(document.querySelector<HTMLInputElement>('[data-note-position]')!.value).toBe("xiv");
  expect(hasOpenSurface()).toBe(true);
  // Once the child is gone, the parent still owns its unsaved-work guard.
  act(() => opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  await flush();
  expect(document.body.textContent).toContain("Unsaved changes");
  expect(close).not.toHaveBeenCalled();
});

it("cannot detach a pending off-page selection through its loading option", async () => {
  let resolveChoice!: (choice: ReadingChoice) => void;
  actions.getReadingChoice.mockReturnValueOnce(new Promise<ReadingChoice>(resolve => { resolveChoice = resolve; }));
  const close = vi.fn();
  act(() => root.render(h(SharedNoteHost, { onClose: close })));
  await flush();
  const body = write("Note", "Still attached while its label loads");
  const label = [...document.querySelectorAll("label")].find(node => node.textContent === "Reading")!;
  const trigger = document.getElementById(label.htmlFor)!;
  act(() => trigger.click());
  const pending = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.includes("Selected reading (loading…)"))!;
  expect(pending.getAttribute("aria-disabled")).toBe("true");
  act(() => pending.click());
  expect(trigger.textContent).toContain("Selected reading (loading…)");
  expect(close).not.toHaveBeenCalled();
  // Resolving the original target still replaces its label; it was not None.
  await act(async () => resolveChoice(choice(42)));
  expect(trigger.textContent).toContain("42nd read");
  expect(body.value).toBe("Still attached while its label loads");
});


it("keeps the parent Cancel guarded after a nested chooser is dismissed", async () => {
  const close = vi.fn();
  act(() => root.render(h(SharedNoteHost, { onClose: close })));
  await flush();
  const body = write("Note", "Parent Cancel must retain this draft");
  click("Choose an older reading");
  await flush();
  cancelChooser();
  await flush();
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  const parentCancel = dialogNamed("Add a note").querySelector<HTMLButtonElement>("button[data-dismiss]");
  expect(parentCancel).toBeTruthy();
  act(() => parentCancel!.click());
  await flush();
  expect(dialogNamed("Unsaved changes")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  expect(body.value).toBe("Parent Cancel must retain this draft");
});
