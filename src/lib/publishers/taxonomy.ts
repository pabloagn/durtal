/**
 * Publishing house taxonomy (task 0176). Pure module: the approved structure
 * and the rules that read a second metadata source.
 *
 * The book trade's three levels (ONIX for Books keeps imprint and publisher
 * apart; library cataloguing records the imprint printed on the book):
 * - group: the corporate owner today (Penguin Random House);
 * - publisher: the company that owns imprints (Knopf Doubleday Publishing Group);
 * - imprint: the brand printed on the book (Vintage International).
 *
 * Rules: a book links to its imprint, else its publisher, else its group. One
 * brand is one house across markets (Penguin Classics); the market goes on the
 * edition. Two companies that only share a name are two houses (Vintage in the
 * UK, Vintage Books in the US). Defunct imprints stay under their last owner.
 * ISBN prefixes belong to publishers (shared US registrants since the 2013
 * merger belong to the group); they are evidence, not proof of an imprint.
 */
import type { HouseKind } from "@/lib/publishers/kinds";

export interface HouseSpec {
  /** Official name */
  name: string;
  kind: HouseKind;
  country?: string;
  /** Current houses to reuse, by exact name (the first that exists) */
  existing?: string[];
  /** Spellings that sources print for this house; they belong to it alone */
  aliases?: string[];
  /** ISBN publisher prefixes, hyphenated ("978-0-679") */
  prefixes?: string[];
  /** Publisher or series text from Open Library that names this house */
  evidence?: RegExp[];
  /** Create only when a book needs it */
  onlyIfUsed?: boolean;
  /** Shown in the dry run */
  note?: string;
  children?: HouseSpec[];
}

const UK = "United Kingdom";
const US = "United States";
const UK_US = "United Kingdom; United States";

export const TAXONOMY: HouseSpec[] = [
  {
    name: "Penguin Random House",
    kind: "group",
    country: UK_US,
    existing: ["Penguin Random House"],
    aliases: [
      "Random House",
      "Penguin Random House LLC",
      "Penguin Random House UK",
    ],
    prefixes: ["978-0-593", "978-0-525"],
    note: "Formed in 2013 from Penguin and Random House; owned by Bertelsmann. Shared US prefixes since the merger.",
    children: [
      {
        name: "Penguin Books",
        kind: "publisher",
        country: UK_US,
        prefixes: ["978-0-14", "978-0-241", "978-0-670"],
        aliases: [
          "Penguin",
          "Penguin Books Ltd",
          "Penguin Books Limited",
          "Penguin Books, Limited",
          "Penguin UK",
          "Penguin Adult",
          "Penguin Group",
          "Penguin Group (USA)",
          "Penguin Publishing Group",
          "Penguin Publishing",
          "Penguin USA",
        ],
        evidence: [
          /^penguin( books)?(,? (ltd|limited))?\.?$/i,
          /^penguin (uk|usa|group|publishing( group)?|adult)\b/i,
        ],
        note: "One Penguin for the UK and the US (decision 1); the market goes on each edition.",
        children: [
          {
            name: "Penguin Classics",
            kind: "imprint",
            country: UK_US,
            existing: ["Penguin Classics"],
            aliases: ["Penguin Classic"],
            evidence: [/^penguin classics?$/i],
          },
          {
            name: "Penguin Modern Classics",
            kind: "imprint",
            country: UK,
            aliases: ["Penguin Modern Classic"],
            evidence: [/^penguin modern classics?$/i],
            onlyIfUsed: true,
          },
          {
            name: "Viking",
            kind: "imprint",
            existing: ["Viking"],
            evidence: [/^viking( penguin| press| books)?$/i],
          },
          {
            name: "Allen Lane",
            kind: "imprint",
            country: UK,
            evidence: [/^allen lane/i],
            onlyIfUsed: true,
          },
          {
            name: "Hamish Hamilton",
            kind: "imprint",
            country: UK,
            evidence: [/^hamish hamilton/i],
            onlyIfUsed: true,
          },
          {
            name: "Penguin Press",
            kind: "imprint",
            evidence: [/^penguin press$/i],
            onlyIfUsed: true,
          },
        ],
      },
      {
        name: "Knopf Doubleday Publishing Group",
        kind: "publisher",
        country: US,
        aliases: ["Knopf Doubleday"],
        prefixes: [
          "978-0-679",
          "978-0-394",
          "978-0-375",
          "978-0-307",
          "978-1-4000",
          "978-0-385",
        ],
        evidence: [/knopf doubleday/i],
        children: [
          {
            name: "Alfred A. Knopf",
            kind: "imprint",
            country: US,
            existing: ["Alfred A. Knopf"],
            aliases: ["Knopf", "Alfred A Knopf", "Alfred A. Knopf, Inc."],
            evidence: [/^(alfred a\.? )?knopf(?! doubleday)/i],
          },
          {
            name: "Doubleday",
            kind: "imprint",
            country: US,
            existing: ["Doubleday"],
            evidence: [/^doubleday\b(?!.*religion)/i],
          },
          {
            name: "Vintage Books",
            kind: "imprint",
            country: US,
            aliases: ["Vintage"],
            evidence: [/^vintage( books)?( usa)?$/i],
            note: "Founded by Knopf in 1954. Not the UK Vintage: a different company with the same name.",
          },
          {
            name: "Vintage International",
            kind: "imprint",
            country: US,
            evidence: [/^vintage international/i],
            onlyIfUsed: true,
          },
          {
            name: "Anchor Books",
            kind: "imprint",
            country: US,
            aliases: ["Anchor"],
            evidence: [/^anchor( books)?$/i],
            onlyIfUsed: true,
          },
          {
            name: "Pantheon Books",
            kind: "imprint",
            country: US,
            aliases: ["Pantheon"],
            evidence: [/^pantheon( books)?$/i],
            onlyIfUsed: true,
          },
        ],
      },
      {
        name: "Random House Publishing Group",
        kind: "publisher",
        country: US,
        prefixes: ["978-0-553", "978-0-345", "978-0-8129"],
        evidence: [/random house publishing group/i],
        children: [
          {
            name: "The Modern Library",
            kind: "imprint",
            country: US,
            existing: ["The Modern Library"],
            aliases: ["Modern Library"],
            evidence: [/modern library/i],
          },
          {
            name: "Random House Worlds",
            kind: "imprint",
            country: US,
            evidence: [/^random house worlds/i],
          },
        ],
      },
      {
        name: "Vintage Publishing",
        kind: "publisher",
        country: UK,
        aliases: ["Random House UK", "The Random House Group"],
        prefixes: [
          "978-0-09",
          "978-1-78487",
          "978-1-5291",
          "978-1-5299",
          "978-0-7493",
          "978-0-436",
          "978-1-86046",
          "978-1-4481",
        ],
        evidence: [
          /^vintage publishing/i,
          /^random house (uk|group)/i,
          /^the random house group/i,
        ],
        note: "The UK division that holds Vintage and the old Reed and Random House UK literary imprints.",
        children: [
          {
            name: "Vintage",
            kind: "imprint",
            country: UK,
            existing: ["Vintage"],
            aliases: ["Vintage Books", "Vintage UK"],
            evidence: [/^vintage( books)?( uk)?$/i],
          },
          {
            name: "Vintage Classics",
            kind: "imprint",
            country: UK,
            aliases: ["Vintage Classic"],
            evidence: [/^vintage classics?$/i],
          },
          {
            name: "Harvill Press",
            kind: "imprint",
            country: UK,
            existing: ["Harvill Press"],
            aliases: ["The Harvill Press", "Harvill"],
            evidence: [/^(the )?harvill( press)?$/i],
            note: "Defunct: merged into Harvill Secker in 2005.",
          },
          {
            name: "Secker & Warburg",
            kind: "imprint",
            country: UK,
            existing: ["Secker and Warburg", "Secker & Warburg"],
            aliases: [
              "Secker and Warburg",
              "Martin Secker & Warburg",
              "Martin Secker and Warburg",
            ],
            evidence: [/^(martin )?secker (&|and) warburg/i],
            note: "Defunct: merged into Harvill Secker in 2005.",
          },
          {
            name: "Mandarin Paperbacks",
            kind: "imprint",
            country: UK,
            aliases: ["Mandarin"],
            evidence: [/^mandarin( paperbacks)?$/i],
            note: "Defunct Reed paperback imprint; Random House UK bought Reed's trade imprints in 1997.",
          },
          {
            name: "Minerva",
            kind: "imprint",
            country: UK,
            evidence: [/^minerva$/i],
            note: "Defunct Reed literary paperback imprint, later part of Vintage.",
          },
          {
            name: "Harvill Secker",
            kind: "imprint",
            country: UK,
            evidence: [/^harvill secker/i],
            onlyIfUsed: true,
          },
          {
            name: "Chatto & Windus",
            kind: "imprint",
            country: UK,
            evidence: [/^chatto (&|and) windus/i],
            onlyIfUsed: true,
          },
          {
            name: "Jonathan Cape",
            kind: "imprint",
            country: UK,
            evidence: [/^jonathan cape/i],
            onlyIfUsed: true,
          },
        ],
      },
      {
        name: "Ebury Publishing",
        kind: "publisher",
        country: UK,
        existing: ["Ebury Publishing"],
        aliases: ["Ebury Press", "Ebury"],
        prefixes: ["978-0-7535"],
        evidence: [/^ebury/i],
      },
      {
        name: "Penguin Random House Grupo Editorial",
        kind: "publisher",
        country: "Spain",
        prefixes: ["978-84-397"],
        evidence: [/penguin random house grupo editorial/i],
        children: [
          {
            name: "Literatura Random House",
            kind: "imprint",
            country: "Spain",
            evidence: [/^literatura random house/i],
          },
        ],
      },
    ],
  },
  {
    name: "HarperCollins",
    kind: "group",
    country: UK_US,
    existing: ["HarperCollins"],
    note: "Owned by News Corp.",
    children: [
      {
        name: "HarperCollins Publishers",
        kind: "publisher",
        country: UK_US,
        aliases: [
          "HarperCollins Publishers Limited",
          "HarperCollins UK",
          "Harper Collins",
          "HarperCollins Publishers Ltd",
        ],
        prefixes: ["978-0-06", "978-0-00"],
        evidence: [/^harper ?collins( publishers)?( (ltd|limited|uk))?$/i],
        note: "One HarperCollins Publishers for the UK and the US, like Penguin Books (decision 1).",
        children: [
          {
            name: "Harper Perennial",
            kind: "imprint",
            aliases: ["Perennial", "Harper Perennial Modern Classics"],
            evidence: [/^(harper )?perennial/i],
          },
          {
            name: "William Morrow",
            kind: "imprint",
            country: US,
            aliases: ["William Morrow & Company", "William Morrow and Company"],
            evidence: [/^william morrow/i],
          },
          {
            name: "HarperOne",
            kind: "imprint",
            country: US,
            existing: ["HarperOne"],
            evidence: [/^harperone/i],
          },
          {
            name: "Fourth Estate",
            kind: "imprint",
            country: UK,
            aliases: ["4th Estate"],
            evidence: [/^(fourth|4th) estate/i],
            onlyIfUsed: true,
          },
        ],
      },
    ],
  },
  {
    name: "Macmillan",
    kind: "group",
    country: UK_US,
    existing: ["Macmillan Publishers", "Macmillan"],
    aliases: ["Macmillan Publishers"],
    note: "Owned by Holtzbrinck.",
    children: [
      {
        name: "Pan Macmillan",
        kind: "publisher",
        country: UK,
        aliases: ["Pan Macmillan Ltd"],
        prefixes: [
          "978-1-5290",
          "978-1-0350",
          "978-1-5098",
          "978-0-330",
          "978-1-4472",
        ],
        evidence: [/^pan macmillan/i],
        children: [
          {
            name: "Picador",
            kind: "imprint",
            country: UK,
            evidence: [/^picador$/i],
          },
          {
            name: "Pan Books",
            kind: "imprint",
            country: UK,
            aliases: ["Pan"],
            evidence: [/^pan( books)?$/i],
            onlyIfUsed: true,
          },
        ],
      },
      {
        name: "Farrar, Straus and Giroux",
        kind: "publisher",
        country: US,
        existing: ["Farrar, Straus and Giroux"],
        aliases: ["FSG", "Farrar Straus Giroux", "Farrar, Straus & Giroux"],
        prefixes: ["978-0-374"],
        evidence: [/^farrar/i],
      },
    ],
  },
  {
    name: "Profile Books",
    kind: "publisher",
    country: UK,
    aliases: ["Profile Books Limited", "Profile Books Ltd"],
    prefixes: [
      "978-1-78125",
      "978-1-78816",
      "978-1-80081",
      "978-1-80649",
      "978-1-84668",
      "978-1-85242",
    ],
    evidence: [/^profile books/i],
    note: "Independent.",
    children: [
      {
        name: "Serpent's Tail",
        kind: "imprint",
        country: UK,
        existing: ["Serpent's Tail"],
        evidence: [/^serpent'?s tail/i],
      },
      {
        name: "Souvenir Press",
        kind: "imprint",
        country: UK,
        evidence: [/^souvenir press/i],
      },
      {
        name: "Tuskar Rock",
        kind: "imprint",
        country: UK,
        aliases: ["Tuskar Rock Press"],
        evidence: [/^tuskar rock/i],
      },
    ],
  },
  {
    name: "Oxford University Press",
    kind: "publisher",
    country: UK,
    existing: ["Oxford University Press"],
    aliases: ["OUP Oxford", "OUP", "Oxford University Press, Incorporated"],
    prefixes: ["978-0-19"],
    evidence: [/^oxford university press/i, /^oup\b/i],
    note: "University press, no group.",
  },
  {
    name: "Bloomsbury Publishing",
    kind: "publisher",
    country: UK,
    existing: ["Bloomsbury Publishing"],
    prefixes: ["978-0-7475", "978-1-4088", "978-1-78093"],
    evidence: [/^bloomsbury( publishing)?( plc)?$/i],
    children: [
      {
        name: "Bloomsbury Paperbacks",
        kind: "imprint",
        country: UK,
        evidence: [/^bloomsbury paperbacks/i],
      },
      {
        name: "Bloomsbury T&T Clark",
        kind: "imprint",
        country: UK,
        existing: ["Bloomsbury T&T Clark"],
        evidence: [/t ?& ?t clark/i],
      },
    ],
  },
];

/** Names that are not publishers of these books */
export const NOT_PUBLISHERS = [
  {
    name: "National Geographic Books",
    reason:
      "ISBNdb puts this label on Penguin and Knopf books; the ISBN and Open Library find the real imprint.",
  },
];

/** ISBN prefixes whose books come from one market; others (978-0-14, 978-0-19) are shared */
export const PREFIX_MARKET: Record<string, string> = Object.fromEntries([
  ...[
    "978-0-241",
    "978-0-09",
    "978-1-78487",
    "978-1-5291",
    "978-1-5299",
    "978-0-7493",
    "978-0-436",
    "978-1-86046",
    "978-1-4481",
    "978-0-7535",
    "978-0-00",
    "978-0-7475",
    "978-1-4088",
    "978-1-5290",
    "978-1-0350",
    "978-1-5098",
    "978-0-330",
    "978-1-4472",
    "978-1-78125",
    "978-1-78816",
    "978-1-80081",
    "978-1-80649",
    "978-1-84668",
    "978-1-85242",
  ].map((p) => [p, UK]),
  ...[
    "978-0-679",
    "978-0-394",
    "978-0-375",
    "978-0-307",
    "978-1-4000",
    "978-0-385",
    "978-0-06",
    "978-0-374",
    "978-0-553",
    "978-0-345",
    "978-0-8129",
    "978-0-593",
    "978-0-525",
    "978-0-670",
  ].map((p) => [p, US]),
  ["978-84-397", "Spain"],
]);

const PLACE_MARKET: [RegExp, string][] = [
  [
    /\b(london|harmondsworth|middlesex|edinburgh|england|united kingdom|great britain)\b/i,
    UK,
  ],
  [
    /\b(new york|n\.\s?y\.?|boston|chicago|san francisco|united states|usa)\b/i,
    US,
  ],
];

/** "978-0-679" → "9780679" */
export function prefixDigits(label: string) {
  return label.replace(/-/g, "");
}

export interface FlatHouse {
  spec: HouseSpec;
  /** Names from the group down to this house */
  path: string[];
  parent: string | null;
  /** ISBN prefixes (digits) of its own publisher (a group: all of its own) */
  allowedPrefixes: string[];
  /** ISBN prefixes (digits) anywhere in its group or independent house */
  familyPrefixes: string[];
}

/** Every house of the taxonomy, parents before children */
export function flattenTaxonomy(spec: HouseSpec[] = TAXONOMY): FlatHouse[] {
  const out: FlatHouse[] = [];
  const all = (s: HouseSpec): string[] => [
    ...(s.prefixes ?? []).map(prefixDigits),
    ...(s.children ?? []).flatMap(all),
  ];
  function walk(
    s: HouseSpec,
    path: string[],
    parent: HouseSpec | null,
    root: HouseSpec,
  ) {
    const own =
      s.kind === "imprint"
        ? (parent?.prefixes ?? []).map(prefixDigits)
        : (s.prefixes ?? []).map(prefixDigits);
    out.push({
      spec: s,
      path: [...path, s.name],
      parent: parent?.name ?? null,
      allowedPrefixes: s.kind === "group" ? all(s) : own,
      familyPrefixes: all(root),
    });
    for (const c of s.children ?? []) walk(c, [...path, s.name], s, root);
  }
  for (const root of spec) walk(root, [], null, root);
  return out;
}

const KIND_RANK: Record<HouseKind, number> = {
  imprint: 0,
  publisher: 1,
  group: 2,
};

export interface EditionEvidence {
  /** ISBN digits (13, or 978 + the ISBN-10's first nine) */
  isbn: string | null;
  /** Its ISBN publisher prefix, hyphenated */
  prefix: string | null;
  publishers: string[];
  series: string[];
  places: string[];
}

export interface EvidencePlan {
  /** The most specific house a source names, if the ISBN agrees */
  house: FlatHouse | null;
  /** The source text that named it */
  text: string | null;
  /** Why no house was taken, when a source named one */
  refused: string | null;
  market: string | null;
  marketFrom: string | null;
}

/**
 * The house a second source names for one edition. A house is taken only when
 * the ISBN prefix belongs to its publisher; failing that, to its group (US
 * divisions of one group share prefixes). A source that names a house of
 * another company is refused. Series text counts like publisher text
 * ("Penguin classics"). The most specific house wins.
 */
export function planEdition(
  e: EditionEvidence,
  houses: FlatHouse[] = flattenTaxonomy(),
): EvidencePlan {
  const texts = [...e.series, ...e.publishers]
    .map((t) => t.trim())
    .filter(Boolean);
  const named: { house: FlatHouse; text: string }[] = [];
  for (const text of texts)
    for (const house of houses)
      if (house.spec.evidence?.some((r) => r.test(text)))
        named.push({ house, text });
  named.sort(
    (a, b) => KIND_RANK[a.house.spec.kind] - KIND_RANK[b.house.spec.kind],
  );
  const fromPlace = [
    ...new Set(
      e.places.flatMap((p) =>
        PLACE_MARKET.filter(([r]) => r.test(p)).map(([, m]) => m),
      ),
    ),
  ];
  const fromPrefix = e.prefix ? (PREFIX_MARKET[e.prefix] ?? null) : null;
  let market: string | null = null;
  let marketFrom: string | null = null;
  if (fromPlace.length === 1 && (!fromPrefix || fromPrefix === fromPlace[0])) {
    market = fromPlace[0];
    marketFrom = `place of publication: ${e.places.join(", ")}`;
  } else if (!fromPlace.length && fromPrefix) {
    market = fromPrefix;
    marketFrom = `ISBN prefix ${e.prefix}`;
  }
  const fits = (prefixes: string[]) =>
    !!e.isbn && prefixes.some((p) => e.isbn!.startsWith(p));
  // On a prefix the whole group shares, a same-name house of the book's market wins
  const inMarket = (h: FlatHouse) =>
    market && h.spec.country?.includes(market) ? 0 : 1;
  const taken =
    named.find((n) => fits(n.house.allowedPrefixes)) ??
    named
      .filter((n) => fits(n.house.familyPrefixes))
      .sort(
        (a, b) =>
          KIND_RANK[a.house.spec.kind] - KIND_RANK[b.house.spec.kind] ||
          inMarket(a.house) - inMarket(b.house),
      )[0] ??
    null;
  const refused =
    !taken && named.length
      ? `Open Library names “${named[0].text}”, but the ISBN belongs to another publisher`
      : null;
  return {
    house: taken?.house ?? null,
    text: taken?.text ?? null,
    refused,
    market,
    marketFrom,
  };
}
