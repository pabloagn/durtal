import { describe, expect, it } from "vitest";
import {
  AUTHOR_FILL_COLUMNS,
  AUTHOR_NAME_COLUMNS,
  authorBio,
  chooseMatch,
  chooseTime,
  dayNumber,
  describedCountry,
  gregorianDate,
  gregorianYear,
  nameForms,
  nameRank,
  nationalityCheck,
  nextAuthorRow,
  personGender,
  personNationality,
  pickPlace,
  placeChain,
  planAuthor,
  planDate,
  sameTitle,
  settlementOf,
  type AuthorEvidence,
  type AuthorRow,
  type CatalogueDate,
  type PlanContext,
} from "@/lib/authors/enrichment";
import { parseTime, type PersonItem, type PlaceItem, type WikidataTime } from "@/lib/authors/wikidata";

const NO_DATE: CatalogueDate = { year: null, month: null, day: null, approximate: false, gregorian: null };

const author = (over: Partial<AuthorEvidence>): AuthorEvidence => ({
  id: "a",
  slug: "a",
  name: "Italo Calvino",
  sortName: "Calvino, Italo",
  firstName: null,
  lastName: null,
  realName: null,
  aliases: [],
  gender: null,
  nationality: null,
  birth: NO_DATE,
  death: NO_DATE,
  birthPlaceId: null,
  deathPlaceId: null,
  bio: null,
  website: null,
  openLibraryKey: null,
  goodreadsId: null,
  zodiacSign: null,
  works: [],
  ...over,
});

const day = (year: number, month: number, d: number, julian = false): WikidataTime => ({
  year,
  month,
  day: d,
  precision: 11,
  julian,
  circa: false,
});
const yearOnly = (year: number, precision = 9, circa = false): WikidataTime => ({
  year,
  month: null,
  day: null,
  precision,
  julian: false,
  circa,
});

const person = (id: string, over: Partial<PersonItem>): PersonItem => ({
  id,
  label: null,
  description: null,
  aliases: [],
  classes: ["Q5"],
  genders: [],
  births: [],
  deaths: [],
  birthPlaces: [],
  deathPlaces: [],
  citizenships: [],
  occupations: [],
  birthNames: [],
  openLibrary: [],
  goodreads: [],
  websites: [],
  notableWorks: [],
  movements: [],
  enwiki: null,
  ...over,
});
const place = (id: string, over: Partial<PlaceItem>): PlaceItem => ({
  id,
  label: null,
  description: null,
  classes: [],
  countries: [],
  alpha2: null,
  dissolved: null,
  coordinates: null,
  within: [],
  ...over,
});
const places: Record<string, PlaceItem | null> = {
  Q38: place("Q38", { label: "Italy", alpha2: "IT", countries: ["Q38"] }),
  Q241: place("Q241", { label: "Cuba", alpha2: "CU", countries: ["Q241"] }),
  Q159: place("Q159", { label: "Russia", alpha2: "RU", countries: ["Q159"] }),
  Q36: place("Q36", { label: "Poland", alpha2: "PL", countries: ["Q36"] }),
  Q34266: place("Q34266", { label: "Russian Empire", dissolved: 1917 }),
  Q1282: place("Q1282", { label: "Tuscany", countries: ["Q38"], within: ["Q38"] }),
  Q2751: place("Q2751", {
    label: "Siena",
    countries: ["Q38"],
    within: ["Q1282"],
    coordinates: { latitude: 43.318, longitude: 11.331 },
  }),
  Q649: place("Q649", { label: "Moscow", countries: ["Q159"], within: ["Q159"] }),
  QH: place("QH", { label: "Mariinsky Hospital for the Poor", description: "hospital in Russia", countries: ["Q159"], within: ["Q649"] }),
};
const calvino = person("Q154756", {
  label: "Italo Calvino",
  description: "Italian journalist and writer (1923-1985)",
  genders: ["Q6581097"],
  births: [day(1923, 10, 15)],
  deaths: [day(1985, 9, 19)],
  deathPlaces: ["Q2751"],
  citizenships: ["Q38"],
  occupations: ["Q36180"],
  birthNames: [{ text: "Italo Giovanni Calvino Mameli", language: "it" }],
  openLibrary: ["OL4326372A"],
  goodreads: ["155517"],
  websites: ["http://www.italocalvino.org/"],
  notableWorks: ["QW1"],
});
const ctx = (over: Partial<PlanContext>): PlanContext => ({
  people: { Q154756: calvino },
  places,
  labels: { QW1: { id: "QW1", label: "Invisible Cities", description: null } },
  works: {},
  candidates: ["Q154756"],
  ...over,
});

describe("author names", () => {
  it("searches the name, its inversions and the name without a title", () => {
    expect(nameForms(author({ name: "Makiya, Kanan", sortName: "Kanan, Makiya," }))).toContain("Kanan Makiya");
    expect(nameForms(author({ name: "Saint Augustine (of Hippo)", sortName: null }))).toContain(
      "Augustine of Hippo",
    );
    expect(nameForms(author({ name: "Sir Arthur Conan Doyle", sortName: null }))).toContain("Arthur Conan Doyle");
  });

  it("ranks a Wikidata name against the author's", () => {
    const forms = (name: string) => nameForms(author({ name, sortName: null }));
    expect(nameRank(forms("Ágota Kristóf"), "Agota Kristof", [])).toBe(4);
    expect(nameRank(forms("Petronius Arbiter"), "Petronius", ["Petronius Arbiter"])).toBe(3);
    expect(nameRank(forms("Yan Mo"), "Mo Yan", [])).toBe(3);
    expect(nameRank(forms("Miguel Cervantes"), "Miguel de Cervantes", [])).toBe(3);
    expect(nameRank(forms("Christopher R. Browning"), "Christopher Browning", [])).toBe(3);
    expect(nameRank(forms("B. V. Savinkov"), "Boris Savinkov", [])).toBe(2);
    expect(nameRank(forms("Calvino"), "Italo Calvino", [])).toBe(1);
    expect(nameRank(forms("John Gray"), "James Gray", [])).toBe(-1);
  });
});

describe("author dates", () => {
  it("reads Wikidata times: civil years before Christ, precision, circa", () => {
    const t = parseTime({
      rank: "preferred",
      mainsnak: {
        datavalue: {
          value: {
            time: "-0044-03-15T00:00:00Z",
            precision: 11,
            calendarmodel: "http://www.wikidata.org/entity/Q1985786",
          },
        },
      },
    });
    expect(t).toEqual({ year: -44, month: 3, day: 15, precision: 11, julian: true, circa: false });
    const circa = parseTime({
      mainsnak: { datavalue: { value: { time: "+1850-00-00T00:00:00Z", precision: 9 } } },
      qualifiers: { P1480: [{ datavalue: { value: { id: "Q5727902" } } }] },
    });
    expect(circa).toMatchObject({ year: 1850, month: null, day: null, circa: true });
  });

  it("converts Julian dates to the Gregorian calendar", () => {
    // Newton: 25 December 1642 (Julian) is 4 January 1643
    expect(gregorianDate(dayNumber(1642, 12, 25, true))).toEqual({ year: 1643, month: 1, day: 4 });
    // Caesar's death: 15 March 44 BC (Julian) is 13 March 44 BC
    expect(gregorianDate(dayNumber(-44, 3, 15, true))).toEqual({ year: -44, month: 3, day: 13 });
    expect(gregorianYear(day(1642, 12, 25, true))).toBe(1643);
    expect(gregorianYear({ ...day(1642, 12, 25, true), precision: 10, day: null })).toBeNull();
    expect(gregorianYear(day(1923, 10, 15))).toBeNull();
  });

  it("uses one date when Wikidata's agree, and none when they do not", () => {
    // The same day in two calendars: the Gregorian one after 1582
    const savinkov = [day(1879, 1, 19, true), day(1879, 1, 31)];
    expect(chooseTime(savinkov, null).time).toEqual(day(1879, 1, 31));
    expect(chooseTime([yearOnly(1925), yearOnly(1926)], null)).toEqual({ time: null, conflict: true });
    expect(chooseTime([yearOnly(1925), yearOnly(1926)], 1926).time).toEqual(yearOnly(1926));
    // Two days in one month and year: the month and the year are certain
    expect(chooseTime([day(2004, 10, 8), day(2004, 10, 9)], null).time).toEqual({
      year: 2004,
      month: 10,
      day: null,
      precision: 10,
      julian: false,
      circa: false,
    });
    // Two days in different months: the year only
    expect(chooseTime([day(1957, 6, 26), day(1957, 7, 2)], null).time).toMatchObject({ year: 1957, month: null, precision: 9 });
  });

  it("fills an empty date to the precision Wikidata gives", () => {
    expect(planDate("birth", NO_DATE, [day(1923, 10, 15)]).fill).toEqual({ year: 1923, month: 10, day: 15 });
    expect(planDate("birth", NO_DATE, [yearOnly(1850, 9, true)]).fill).toEqual({ year: 1850, approximate: true });
    expect(planDate("birth", NO_DATE, [yearOnly(1850, 8)]).fill).toEqual({ year: 1850, approximate: true });
    const century = planDate("birth", NO_DATE, [yearOnly(-500, 7)]);
    expect(century.fill).toEqual({});
    expect(century.notes[0]).toMatch(/century/);
    expect(planDate("birth", NO_DATE, [day(1642, 12, 25, true)]).fill).toEqual({
      year: 1642,
      month: 12,
      day: 25,
      gregorian: 1643,
    });
  });

  it("adds a missing month only when the stored day agrees", () => {
    const fowles = { ...NO_DATE, year: 1926, day: 31 };
    const agrees = planDate("birth", fowles, [day(1926, 3, 31)]);
    expect(agrees.fill).toEqual({ month: 3 });
    expect(agrees.agree).toBe("exact");
    expect(agrees.dayAgrees).toBe(true);
    const differs = planDate("birth", fowles, [day(1926, 3, 30)]);
    expect(differs.fill).toEqual({});
    expect(differs.dayAgrees).toBe(false);
    expect(differs.disagreements[0]).toMatch(/day/);
  });

  it("puts back a missing minus sign, and never changes a year that differs", () => {
    const lie = planDate("birth", { ...NO_DATE, year: 450 }, [yearOnly(-450)]);
    expect(lie.fill).toEqual({ year: -450 });
    expect(lie.corrections[0]).toMatch(/450 BC/);
    const other = planDate("death", { ...NO_DATE, year: 1990 }, [yearOnly(1995)]);
    expect(other.fill).toEqual({});
    expect(other.agree).toBe("differs");
    expect(other.disagreements[0]).toMatch(/catalogue 1990, Wikidata 1995/);
    expect(planDate("death", { ...NO_DATE, year: 1990 }, [yearOnly(1991)]).agree).toBe("near");
  });
});

describe("gender and nationality", () => {
  it("takes gender only from P21, and only when it is clear", () => {
    expect(personGender(person("Q1", { genders: ["Q6581072"] }))).toBe("female");
    expect(personGender(person("Q1", { genders: ["Q1052281"] }))).toBe("female");
    expect(personGender(person("Q1", { genders: ["Q48270"] }))).toBeNull();
    expect(personGender(person("Q1", { genders: ["Q6581097", "Q6581072"] }))).toBeNull();
    expect(personGender(person("Q1", {}))).toBeNull();
  });

  it("reads one country from a description, never a language", () => {
    expect(describedCountry("Colombian novelist")).toBe("CO");
    expect(describedCountry("German-language Czech writer")).toBe("CZ");
    expect(describedCountry("Russian-American novelist")).toBeNull();
    expect(describedCountry(null)).toBeNull();
  });

  it("fills the one country of today, unless the description names another", () => {
    expect(personNationality(calvino, places)).toBe("IT");
    // Russian Empire no longer exists; the description gives the country
    const tolstoy = person("Q7243", { description: "Russian writer", citizenships: ["Q34266"], births: [day(1828, 9, 9)] });
    expect(personNationality(tolstoy, places)).toBe("RU");
    // "Russian writer" with Polish citizenship: neither
    const savinkov = person("Q381859", { description: "Russian writer", citizenships: ["Q34266", "Q36"], births: [day(1879, 1, 31)] });
    expect(personNationality(savinkov, places)).toBeNull();
    // No country of today for antiquity
    const plato = person("Q859", { description: "Greek philosopher", births: [yearOnly(-428)] });
    expect(personNationality(plato, places)).toBeNull();
  });
});

describe("matching", () => {
  it("matches a book title with its subtitle, volume or filler words", () => {
    expect(sameTitle("The Aesthetics of Resistance, Volume I", "The Aesthetics of Resistance")).toBe(true);
    expect(sameTitle("Complete Maus", "Maus")).toBe(true);
    expect(sameTitle("The Dead A Novel", "The Dead")).toBe(true);
    expect(sameTitle("Senselessness", "Revulsion")).toBe(false);
    expect(sameTitle("Nada", "Nada y nada")).toBe(false);
    expect(sameTitle("The Bridge Over the Drina", "The Bridge on the Drina")).toBe(true);
    expect(
      sameTitle("The Decline and Fall of the Roman Empire, Volumes 1 to 6", "The History of the Decline and Fall of the Roman Empire"),
    ).toBe(true);
    expect(sameTitle("The Little Demon", "The Petty Demon")).toBe(false);
  });

  it("matches a person who wrote one of the author's books", () => {
    const plan = planAuthor(author({ name: "Calvino", sortName: "Calvino", works: [{ title: "Invisible Cities", year: 2002 }] }), ctx({}));
    expect(plan.match).toMatchObject({ id: "Q154756", confidence: "high" });
  });

  it("rules out a person born after one of the author's books", () => {
    const son = person("Q135117250", { label: "Fyodor Dostoyevsky", births: [day(1871, 7, 16)] });
    const a = author({ name: "Fyodor Dostoyevsky", sortName: null, works: [{ title: "Notes from Underground", year: 1864 }] });
    const plan = chooseMatch(a, ctx({ people: { Q135117250: son }, candidates: ["Q135117250"] }));
    expect(plan.match).toBeNull();
    expect(plan.candidates[0].level).toBe("excluded");
    expect(plan.candidates[0].hard[0]).toMatch(/predates/);
  });

  it("rules out a person of the other gender, or born in another year", () => {
    const a = author({ gender: "female", works: [{ title: "Invisible Cities", year: 2002 }] });
    expect(chooseMatch(a, ctx({})).match).toBeNull();
    const b = author({ birth: { ...NO_DATE, year: 1950 }, works: [{ title: "Invisible Cities", year: 2002 }] });
    expect(chooseMatch(b, ctx({})).candidates[0].hard[0]).toMatch(/birth year/);
  });

  it("holds a match whose nationality differs, unless a book proves the person", () => {
    const plan = chooseMatch(author({ nationality: "FR", birth: { ...NO_DATE, year: 1923 } }), ctx({}));
    expect(plan.match).toBeNull();
    expect(plan.held[0]).toMatch(/nationality/);
    // With one of the author's books: matched, and the difference is reported
    const proved = planAuthor(author({ nationality: "FR", works: [{ title: "Invisible Cities", year: 2002 }] }), ctx({}));
    expect(proved.match?.confidence).toBe("high");
    expect(proved.disagreements).toContain("nationality: catalogue FR, Wikidata IT");
  });

  it("never holds a nationality against a birthplace: borders move", () => {
    // Born in today's Ukraine, a citizen of states that no longer exist
    const schulz = person("Q148886", { birthPlaces: ["QD"], citizenships: ["Q34266"] });
    const withBirthplace = { ...places, QD: place("QD", { label: "Drohobych", countries: ["QUA"] }), QUA: place("QUA", { label: "Ukraine", alpha2: "UA" }) };
    expect(nationalityCheck("PL", schulz, withBirthplace)).toEqual({ agrees: false, stated: [] });
    expect(nationalityCheck("UA", schulz, withBirthplace).agrees).toBe(true);
  });

  it("matches on dates when no book is known, and needs more than the name alone", () => {
    const dated = author({ birth: { ...NO_DATE, year: 1923 }, nationality: "IT" });
    expect(chooseMatch(dated, ctx({})).match?.confidence).toBe("high");
    // The one writer of that name: medium
    expect(chooseMatch(author({}), ctx({})).match?.confidence).toBe("medium");
    // Someone of that name who is not a writer: held back, unless a fact agrees
    const namesake = { ...calvino, occupations: [], description: "Italian cyclist" };
    expect(chooseMatch(author({}), ctx({ people: { Q154756: namesake } })).match).toBeNull();
    expect(chooseMatch(author({ nationality: "IT" }), ctx({ people: { Q154756: namesake } })).match?.confidence).toBe("medium");
  });

  it("holds the author when two people fit as well", () => {
    const twin = { ...calvino, id: "Q2", notableWorks: ["QW1"] };
    const a = author({ works: [{ title: "Invisible Cities", year: 2002 }] });
    const plan = chooseMatch(a, ctx({ people: { Q154756: calvino, Q2: twin }, candidates: ["Q154756", "Q2"] }));
    expect(plan.match).toBeNull();
    expect(plan.held[0]).toMatch(/several people fit/);
  });

  it("follows review decisions", () => {
    const a = author({ works: [{ title: "Invisible Cities", year: 2002 }] });
    expect(chooseMatch(a, ctx({ review: { name: "x", reject: true, note: "not him" } })).match).toBeNull();
    const dup = chooseMatch(a, ctx({ review: { name: "x", duplicateOf: "italo-calvino", note: "twice" } }));
    expect(dup.held[0]).toMatch(/same person as italo-calvino/);
    const accepted = chooseMatch(author({}), ctx({ review: { name: "x", accept: "Q154756", note: "researched" } }));
    expect(accepted.match?.confidence).toBe("reviewed");
  });
});

describe("what is filled", () => {
  const a = author({ name: "Calvino", sortName: "Calvino", works: [{ title: "Invisible Cities", year: 2002 }] });

  it("fills only empty fields, in the catalogue's formats", () => {
    const { fill } = planAuthor(a, ctx({}));
    expect(fill).toMatchObject({
      birth: { year: 1923, month: 10, day: 15 },
      death: { year: 1985, month: 9, day: 19 },
      zodiacSign: "libra",
      gender: "male",
      nationality: "IT",
      deathPlace: "Q2751",
      realName: "Italo Giovanni Calvino Mameli",
      website: "http://www.italocalvino.org/",
      openLibraryKey: "/authors/OL4326372A",
      goodreadsId: "155517",
    });
    const full = planAuthor(
      { ...a, gender: "male", website: "https://example.org", realName: "Italo", openLibraryKey: "/authors/OL1A" },
      ctx({}),
    ).fill;
    expect(full.gender).toBeUndefined();
    expect(full.website).toBeUndefined();
    expect(full.realName).toBeUndefined();
    expect(full.openLibraryKey).toBeUndefined();
  });

  it("skips what a review found wrong, in the fields and in the About text", () => {
    const plan = planAuthor(a, ctx({ review: { name: "Calvino", skip: ["realName", "deathPlace"], note: "checked" } }));
    expect(plan.fill.realName).toBeUndefined();
    expect(plan.fill.deathPlace).toBeUndefined();
    expect(plan.fill.bio).not.toMatch(/Siena/);
  });

  it("reads the zodiac sign of a Julian date in the Gregorian calendar", () => {
    // 15 September 1700 (Julian) is 26 September: Libra, not Virgo
    const julian = person("Q1", { label: "Italo Calvino", births: [day(1700, 9, 15, true)], notableWorks: ["QW1"] });
    const plan = planAuthor(a, ctx({ people: { Q1: julian }, candidates: ["Q1"] }));
    expect(plan.fill.birth).toEqual({ year: 1700, month: 9, day: 15, gregorian: 1700 });
    expect(plan.fill.zodiacSign).toBe("libra");
  });

  it("writes an About text from facts, escaped, with the years the page shows", () => {
    const bio = planAuthor(a, ctx({})).fill.bio!;
    expect(bio).toBe(
      "<p>Italian journalist and writer. Born in 1923; died in Siena, Italy, in 1985. Notable works include <em>Invisible Cities</em>.</p>",
    );
    const odd = person("Q9", {
      description: "poet <b>(27–66)",
      births: [yearOnly(27, 9, true)],
      birthPlaces: ["QH"],
    });
    expect(authorBio(odd, { places, labels: {} }, { birthYear: 27, birthApprox: true, deathYear: null, deathApprox: false })).toBe(
      "<p>Poet &lt;b&gt;. Born in Moscow, Russia, around AD 27.</p>",
    );
    // A description alone is not enough
    expect(authorBio(person("Q9", { description: "poet" }), { places, labels: {} }, { birthYear: null, birthApprox: false, deathYear: null, deathApprox: false })).toBeNull();
  });

  it("takes the most precise of several places only when the others contain it", () => {
    const nested = { ...places, QR: place("QR", { label: "Rathgar", within: ["QDU"] }), QDU: place("QDU", { label: "Dublin" }), QX: place("QX", { label: "Trieste" }) };
    expect(pickPlace(["QR", "QDU"], nested)).toBe("QR");
    expect(pickPlace(["QDU", "QR"], nested)).toBe("QR");
    expect(pickPlace(["QR", "QX"], nested)).toBeNull();
    expect(pickPlace(["QX"], nested)).toBe("QX");
  });

  it("names a Paris arrondissement as Paris in the About text", () => {
    const paris = {
      ...places,
      Q90: place("Q90", { label: "Paris", countries: ["Q142"] }),
      Q142: place("Q142", { label: "France", alpha2: "FR" }),
      Q259463: place("Q259463", { label: "16th arrondissement of Paris", countries: ["Q142"], within: ["Q90"] }),
    };
    const carrere = person("Q1", { description: "French author", birthPlaces: ["Q259463"] });
    expect(authorBio(carrere, { places: paris, labels: {} }, { birthYear: 1957, birthApprox: false, deathYear: null, deathApprox: false })).toBe(
      "<p>French author. Born in Paris, France, in 1957.</p>",
    );
  });

  it("places a person born in a building in its town", () => {
    expect(settlementOf("QH", places)).toBe("Q649");
    expect(settlementOf("Q2751", places)).toBe("Q2751");
  });

  it("builds a place's rows: country, region, place", () => {
    expect(placeChain("Q2751", places)).toEqual({
      levels: [
        { qid: "Q38", name: "Italy", type: "country" },
        { qid: "Q1282", name: "Tuscany", type: "region" },
        { qid: "Q2751", name: "Siena", type: "city" },
      ],
      alpha2: "IT",
      fullName: "Siena, Tuscany, Italy",
    });
    expect(placeChain("Q38", places)?.levels).toEqual([{ qid: "Q38", name: "Italy", type: "country" }]);
  });
});

describe("the row written", () => {
  const empty = Object.fromEntries(AUTHOR_FILL_COLUMNS.map((c) => [c, null])) as AuthorRow;
  const before: AuthorRow = { ...empty, birth_year_is_approximate: false, death_year_is_approximate: false };

  it("never writes images, names or the metadata source", () => {
    for (const column of ["photo_s3_key", "name", "slug", "sort_name", "first_name", "last_name", "metadata_source"])
      expect(AUTHOR_FILL_COLUMNS as readonly string[]).not.toContain(column);
    // A review may put a sort name right, never the display name or the slug
    expect(AUTHOR_NAME_COLUMNS as readonly string[]).not.toContain("name");
    expect(AUTHOR_NAME_COLUMNS as readonly string[]).not.toContain("slug");
    expect(AUTHOR_NAME_COLUMNS as readonly string[]).not.toContain("photo_s3_key");
    const next = nextAuthorRow(before, { gender: "male" }, { nationalityId: null, birthPlaceId: null, deathPlaceId: null, bio: null });
    expect(Object.keys(next).sort()).toEqual([...AUTHOR_FILL_COLUMNS].sort());
  });

  it("fills empty columns and keeps the others", () => {
    const next = nextAuthorRow(
      { ...before, gender: "female", birth_year: 1923, birth_day: 15 },
      { gender: "male", birth: { month: 10, day: 16 }, death: { year: 1985, approximate: true } },
      { nationalityId: "it", birthPlaceId: null, deathPlaceId: "siena", bio: "<p>x</p>" },
    );
    expect(next).toMatchObject({
      gender: "female",
      birth_year: 1923,
      birth_month: 10,
      birth_day: 15,
      death_year: 1985,
      death_year_is_approximate: true,
      nationality_id: "it",
      death_place_id: "siena",
      bio: "<p>x</p>",
    });
  });

  it("writes reviewed corrections over the old values", () => {
    const next = nextAuthorRow(
      { ...before, birth_year: 1984, birth_day: 18, nationality_id: "fr" },
      {},
      { nationalityId: null, birthPlaceId: null, deathPlaceId: null, bio: null },
      { birth: { year: 1985, month: 10, day: 21 }, nationalityId: "ca" },
    );
    expect(next).toMatchObject({ birth_year: 1985, birth_month: 10, birth_day: 21, nationality_id: "ca" });
  });

  it("plans a reviewed correction as the catalogue's value, with its reason", () => {
    const a = author({ birth: { ...NO_DATE, year: 1923, day: 18 }, works: [{ title: "Invisible Cities", year: 2002 }] });
    const plan = planAuthor(a, ctx({ review: { name: "x", correct: { birth: { month: 10, day: 15 } }, note: "checked" } }));
    expect(plan.correct).toEqual({ birth: { month: 10, day: 15 } });
    // Nothing is filled over the corrected date, and the sign follows it
    expect(plan.fill.birth).toBeUndefined();
    expect(plan.fill.zodiacSign).toBe("libra");
    expect(plan.corrections).toEqual(["birth month empty → 10 (checked)", "birth day 18 → 15 (checked)"]);
  });

  it("puts back a year's minus sign", () => {
    const next = nextAuthorRow({ ...before, birth_year: 450 }, { birth: { year: -450 } }, { nationalityId: null, birthPlaceId: null, deathPlaceId: null, bio: null });
    expect(next.birth_year).toBe(-450);
  });
});
