// @vitest-environment happy-dom
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
const mocks = vi.hoisted(() => ({ find: vi.fn(), fast: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, back: vi.fn() }) }));
vi.mock("@/lib/hooks/use-debounced-search", () => ({ useDebouncedSearch: () => ({ setQuery: vi.fn(), clearResults: vi.fn() }) }));
vi.mock("@/lib/hooks/use-app-settings", () => ({ useAppSettings: () => ({ newBookLanguage: "en", newBookStatus: "tracked" }) }));
vi.mock("@/lib/actions/works", () => ({ findDuplicateWork: mocks.find }));
vi.mock("@/lib/actions/fast-track", () => ({ fastTrackBook: mocks.fast }));
vi.mock("@/lib/actions/wizard", () => ({ createBookFromWizard: vi.fn(), isIsbnInUse: vi.fn(async () => ({ inUse: false })) }));
vi.mock("@/lib/ebooks/review-queue/created-book-feedback", () => ({ notifyCreatedBookSuggestions: vi.fn(async () => {}) }));
vi.mock("@/components/shared/escape-to-cancel", () => ({ useEscapeToCancel: () => null }));
vi.mock("@/components/books/instance-form", () => ({ newCopyDraft: () => ({ locationId: "" }) }));
vi.mock("@/app/(catalogue)/library/new/use-wizard-options", () => ({ useWizardOptions: () => ({ recommenders: [], locations: [], lists: {}, defaultLocationId: null }) }));
vi.mock("@/app/(catalogue)/library/new/steps/search-step", () => ({ SearchStep: ({ onManual }: { onManual: () => void }) => h("button", { onClick: onManual }, "Manual") }));
vi.mock("@/app/(catalogue)/library/new/steps/details-step", () => ({ DetailsStep: (p: { work: { title: string; authorName: string }; onChange: (v: object) => void; onNext: () => void; onFastTrack: () => void; errors: { title?: string; authorName?: string } }) => h("div", null,
  h("input", { id: "title", value: p.work.title, onInput: (e: { currentTarget: HTMLInputElement }) => p.onChange({ title: e.currentTarget.value }) }),
  h("input", { id: "author", value: p.work.authorName, onInput: (e: { currentTarget: HTMLInputElement }) => p.onChange({ authorName: e.currentTarget.value }) }),
  h("p", null, p.errors.title), h("p", null, p.errors.authorName), h("button", { onClick: p.onNext }, "Edition details"), h("button", { onClick: p.onFastTrack }, "Fast Track")) }));
vi.mock("@/app/(catalogue)/library/new/steps/duplicate-step", () => ({ DuplicateStep: (p: { onNewWork: () => void; onAddEdition: () => void }) => h("div", null, "Duplicate found", h("button", { onClick: p.onNewWork }, "Create as new"), h("button", { onClick: p.onAddEdition }, "Add edition")) }));
vi.mock("@/app/(catalogue)/library/new/steps/edition-step", () => ({ EditionStep: () => h("input", { id: "edition-isbn" }) }));
import { AddBookWizard } from "@/app/(catalogue)/library/new/wizard";
let root: Root, host: HTMLDivElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  mocks.find.mockReset().mockResolvedValue(null);mocks.fast.mockReset().mockResolvedValue({ ok: true, slug: "new-book", workId: "new" });
  host=document.createElement("div");document.body.append(host);root=createRoot(host);act(()=>root.render(h(AddBookWizard)));
  await click("Manual");
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const tick=()=>act(()=>new Promise(r=>setTimeout(r,40)));
async function click(text: string) { const b=[...host.querySelectorAll("button")].find(e=>e.textContent===text)!;act(()=>b.click());await tick(); }
function fill(id: string,value: string) { const e=host.querySelector<HTMLInputElement>(`#${id}`)!;act(()=>{e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}));}); }
it("blocks empty details, explains both required fields and focuses Title", async()=>{
 await click("Edition details");expect(host.textContent).toContain("Give the book a title");expect(host.textContent).toContain("Give the book an author");expect(document.activeElement?.id).toBe("title");expect(mocks.find).not.toHaveBeenCalled();
});
it("checks manual input before advancing and focuses the next step",async()=>{
 fill("title","A book");fill("author","An author");await click("Edition details");expect(mocks.find).toHaveBeenCalledWith({ title:"A book",authorName:"An author",isbn13:undefined });expect(document.activeElement?.id).toBe("edition-isbn");
});
it("stops Fast Track at the duplicate choice, then respects an explicit Create as new",async()=>{
 mocks.find.mockResolvedValue({id:"existing",title:"A book"});fill("title","A book");fill("author","An author");await click("Fast Track");expect(host.textContent).toContain("Duplicate found");expect(mocks.fast).not.toHaveBeenCalled();await click("Create as new");await click("Fast Track");expect(mocks.fast).toHaveBeenCalledTimes(1);
});
it("checks again if an explicit duplicate choice's identity is edited",async()=>{
 mocks.find.mockResolvedValue({id:"existing",title:"A book"});fill("title","A book");fill("author","An author");await click("Edition details");await click("Create as new");fill("title","Another book");await click("Edition details");expect(mocks.find).toHaveBeenCalledTimes(2);expect(host.textContent).toContain("Duplicate found");
});
