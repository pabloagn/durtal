/*
 * Wikidata and Wikimedia Commons as the film tests know them (SLN-376), in the
 * shape their APIs answer: wbsearchentities, wbgetentities, a haswbstatement
 * search and Commons' imageinfo. The ids are this fixture's own. Two films
 * share the title "Solaris" (a 1972 film and its 2002 remake), a novel shares
 * it too, and a film with 60 cast members takes two calls to name them.
 */

type Snak = { snaktype: "value"; datavalue: { value: unknown } };
type Claim = { rank: string; mainsnak: Snak; qualifiers?: Record<string, Snak[]> };
const snak = (value: unknown): Snak => ({ snaktype: "value", datavalue: { value } });
const item = (id: string) => ({ id });
const time = (iso: string, precision = 11) => ({ time: `+${iso}T00:00:00Z`, precision });
const claim = (value: unknown, qualifiers?: Record<string, unknown[]>, rank = "normal"): Claim => ({
  rank,
  mainsnak: snak(value),
  ...(qualifiers ? { qualifiers: Object.fromEntries(Object.entries(qualifiers).map(([p, values]) => [p, values.map(snak)])) } : {}),
});
const named = (id: string, label: string | null, description?: string) => ({
  id,
  labels: label ? { en: { value: label } } : {},
  ...(description ? { descriptions: { en: { value: description } } } : {}),
});

export const SOLARIS = "Q900101";
export const SOLARIS_REMAKE = "Q900102";
export const SOLARIS_NOVEL = "Q900103";
export const CROWD = "Q900104";

const crowd = Array.from({ length: 60 }, (_, i) => `Q9010${String(i).padStart(2, "0")}`);

export const ENTITIES: Record<string, Record<string, unknown>> = {
  [SOLARIS]: {
    ...named(SOLARIS, "Solaris", "1972 film by Andrei Tarkovsky"),
    claims: {
      P31: [claim(item("Q11424"))],
      P1476: [claim({ text: "Солярис", language: "ru" })],
      // The festival premiere is preferred; every date is a release
      P577: [
        claim(time("1972-05-13"), { P291: [item("Q900201")] }, "preferred"),
        claim(time("1972-03-20"), { P291: [item("Q900202")] }),
        claim(time("1973-05-10"), { P291: [item("Q900204")] }),
      ],
      P495: [claim(item("Q900202"))],
      P364: [claim(item("Q900203"))],
      P2047: [claim({ amount: "+167", unit: "http://www.wikidata.org/entity/Q7727" })],
      P57: [claim(item("Q900301"))],
      P58: [claim(item("Q900301")), claim(item("Q900302"))],
      // Numbered: billing order is the ordinal, not the statement order
      P161: [
        claim(item("Q900303"), { P453: [item("Q900401")], P1545: ["2"] }),
        claim(item("Q900304"), { P4633: ["Kris Kelvin"], P1545: ["1"] }),
        claim(item("Q900305"), { P1545: ["3"] }),
        claim(item("Q900306"), { P1545: ["4"] }, "deprecated"),
      ],
      P86: [claim(item("Q900307"))],
      P272: [claim(item("Q900501"))],
      P345: [claim("tt0069293")],
      P4947: [claim("593")],
      P6127: [claim("solaris")],
      P3383: [claim("Solaris 1972 poster.jpg")],
    },
  },
  [SOLARIS_REMAKE]: {
    ...named(SOLARIS_REMAKE, "Solaris", "2002 film by Steven Soderbergh"),
    claims: {
      P31: [claim(item("Q11424"))],
      P577: [claim(time("2002-11-27"), { P291: [item("Q900205")] })],
      P57: [claim(item("Q900310"))],
      P144: [claim(item(SOLARIS_NOVEL))],
    },
  },
  [SOLARIS_NOVEL]: { ...named(SOLARIS_NOVEL, "Solaris", "1961 novel by Stanisław Lem"), claims: { P31: [claim(item("Q7725634"))] } },
  [CROWD]: {
    ...named(CROWD, "Crowd", "film with a large cast"),
    claims: {
      P31: [claim(item("Q24869"))],
      P577: [claim(time("1990", 9))],
      P161: crowd.map((id) => claim(item(id))),
    },
  },
  Q900201: named("Q900201", "Cannes Film Festival"),
  Q900202: named("Q900202", "Soviet Union"),
  Q900203: named("Q900203", "Russian"),
  Q900204: named("Q900204", "France"),
  Q900205: named("Q900205", "United States"),
  Q900301: named("Q900301", "Andrei Tarkovsky"),
  Q900302: named("Q900302", "Fridrikh Gorenshtein"),
  Q900303: named("Q900303", "Natalya Bondarchuk"),
  Q900304: named("Q900304", "Donatas Banionis"),
  // No English name: left out, and counted
  Q900305: named("Q900305", null),
  Q900306: named("Q900306", "Deprecated Credit"),
  Q900307: named("Q900307", "Eduard Artemyev"),
  Q900310: named("Q900310", "Steven Soderbergh"),
  Q900401: named("Q900401", "Hari"),
  Q900501: named("Q900501", "Mosfilm"),
  ...Object.fromEntries(crowd.map((id, i) => [id, named(id, `Crowd Actor ${i + 1}`)])),
};

export const COMMONS_FILES: Record<string, Record<string, unknown>> = {
  "File:Solaris 1972 poster.jpg": {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Solaris_1972_poster.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Solaris_1972_poster.jpg",
    extmetadata: {
      Artist: { value: '<a href="https://commons.wikimedia.org/wiki/User:Example">Mikhail Romadin</a> &amp; studio' },
      LicenseShortName: { value: "Public domain" },
    },
  },
};

export interface StubState {
  calls: URL[];
  offline: boolean;
  /** An HTTP status every call answers with, such as 429 */
  status: number | null;
  /** Answers changed since the last test: a refresh */
  overrides: Record<string, Record<string, unknown>>;
}
export const stubState = (): StubState => ({ calls: [], offline: false, status: null, overrides: {} });

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

/** A `fetch` that answers Wikidata and Commons from the fixture, and nothing else */
export function wikidataFetch(state: StubState) {
  return (input: string | URL) => {
    const url = new URL(String(input));
    state.calls.push(url);
    if (state.offline) return Promise.reject(new TypeError("fetch failed"));
    if (state.status) return json({}, state.status);
    const p = url.searchParams;
    if (url.host === "commons.wikimedia.org") {
      const title = p.get("titles") ?? "";
      return json({ query: { pages: { "1": COMMONS_FILES[title] ? { title, imageinfo: [COMMONS_FILES[title]] } : { title, missing: "" } } } });
    }
    if (url.host !== "www.wikidata.org") return Promise.reject(new Error(`Unexpected address in a test: ${url.host}`));
    const entities = { ...ENTITIES, ...state.overrides };
    if (p.get("action") === "wbsearchentities") {
      const text = (p.get("search") ?? "").toLowerCase();
      return json({ search: Object.values(entities).filter((e) => JSON.stringify(e.labels).toLowerCase().includes(text)).map((e) => ({ id: e.id })) });
    }
    if (p.get("action") === "query") {
      const [, property, value] = /^haswbstatement:(P\d+)=(.+)$/.exec(p.get("srsearch") ?? "") ?? [];
      const hits = Object.values(entities).filter((e) =>
        ((e.claims as Record<string, Claim[]> | undefined)?.[property] ?? []).some((c) => c.mainsnak.datavalue.value === value),
      );
      return json({ query: { search: hits.map((e) => ({ title: e.id })) } });
    }
    const ids = (p.get("ids") ?? "").split("|");
    if (ids.length > 50) return json({ error: { info: "Too many values supplied for parameter \"ids\". The limit is 50." } });
    const props = p.get("props") ?? "";
    return json({
      entities: Object.fromEntries(
        ids.map((id) => {
          const e = entities[id];
          if (!e) return [id, { id, missing: "" }];
          // Only the parts asked for, as the API answers
          return [id, Object.fromEntries(Object.entries(e).filter(([k]) => k === "id" || props.split("|").includes(k)))];
        }),
      ),
    });
  };
}
