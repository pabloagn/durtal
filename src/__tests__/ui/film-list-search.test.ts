// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useListSearch } from "@/components/films/film-fields";

// A film's countries and languages picker (SLN-881)

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
let root: Root, host: HTMLElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const countries = ["France", "Côte d'Ivoire", "Ivory Coast Republic", "Mexico", "Curaçao"].map((name, i) => ({ id: `c${i}`, name }));

function searchWith(list: typeof countries) {
  let search: ReturnType<typeof useListSearch> = async () => [];
  function Probe() { search = useListSearch(list); return null; }
  act(() => root.render(createElement(Probe)));
  return (query: string) => search(query).then((found) => found.map((c) => c.label));
}

describe("useListSearch", () => {
  it("ignores accents, case and punctuation, starts of words first", async () => {
    const search = searchWith(countries);
    expect(await search("cote")).toEqual(["Côte d'Ivoire"]);
    expect(await search("CURACAO")).toEqual(["Curaçao"]);
    expect(await search("ivo")).toEqual(["Ivory Coast Republic", "Côte d'Ivoire"]);
    expect(await search("co")).toEqual(["Côte d'Ivoire", "Ivory Coast Republic", "Mexico"]);
    expect(await search("")).toHaveLength(5);
  });
});
