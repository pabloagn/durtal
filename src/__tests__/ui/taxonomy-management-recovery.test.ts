// @vitest-environment happy-dom
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/taxonomy/proof", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
import { TaxonomyTree } from "@/components/taxonomy/taxonomy-tree";
import { DeleteItemDialog } from "@/components/taxonomy/delete-item-dialog";
import { taxonomyMergeTargets } from "@/lib/catalogue/taxonomy-management";
const a={ id:"a", name:"Zeta", slug:"zeta", color:null, entityCount:4, sortOrder:0, parentId:null };
const b={ ...a, id:"b", name:"Alpha", slug:"alpha", sortOrder:1 };
const props={familySlug:"proof",hierarchical:false,selectedIds:new Set<string>(),onSelectionChange:vi.fn(),onReorder:vi.fn(),onMove:vi.fn(),onColorChange:vi.fn(),onRename:vi.fn(),onDelete:vi.fn(),onMerge:vi.fn()};
function draw(items=[b,a],canReorder=true){const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(h(TaxonomyTree,{...props,items,canReorder}));return host;}
it("respects the incoming sorted order",()=>{expect([...draw().querySelectorAll("[data-taxonomy-item-name]")].map(x=>x.textContent)).toEqual(["Alpha","Zeta"]);});
it("removes drag controls when the view is not manually reorderable",()=>{expect(draw([a,b],false).querySelector('[aria-label^="Reorder"]')).toBeNull();});
it("names controls by term and allows the name to wrap",()=>{const host=draw();expect(host.querySelector('[aria-label="Actions for Alpha"]')).not.toBeNull();expect(host.querySelector('[aria-label="Pick color for Alpha"]')).not.toBeNull();expect(host.querySelector('[aria-label="4 works"]')).not.toBeNull();expect(host.querySelector('[data-taxonomy-item-name="b"]')?.className).not.toContain("truncate");});
it("offers siblings only, never itself or descendants",()=>{const source={id:"source",parentId:"parent"};const list=[source,{id:"sibling",parentId:"parent"},{id:"child",parentId:"source"},{id:"cousin",parentId:"other"},{id:"parent",parentId:null}];expect(taxonomyMergeTargets(source,list).map(i=>i.id)).toEqual(["sibling"]);});
it.each([{entityCount:0,childCount:1},{entityCount:2,childCount:0}])("does not offer an impossible direct delete: %o",state=>{const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(h(DeleteItemDialog,{open:true,onClose:vi.fn(),item:{id:"a",name:"A",...state},familySlug:"proof",availableReassignTargets:[],onDeleted:vi.fn()}));const button=[...host.querySelectorAll("button")].find(b=>b.textContent==="Delete");expect(button?.disabled).toBe(true);expect(host.textContent).not.toContain("No reassignment");});
