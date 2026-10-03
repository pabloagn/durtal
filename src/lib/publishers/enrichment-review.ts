/**
 * Publisher enrichment decisions a person made after research (SLN-330),
 * where the rules hold a house or would take the wrong item. The key is the
 * house's name; every decision says why. Read by scripts/publishers/enrich.ts.
 */
import type { ReviewDecision } from "@/lib/publishers/enrichment";

export const ENRICHMENT_REVIEW: Record<string, ReviewDecision> = {
  // ── Countries Wikidata does not give ──────────────────────────────────────
  Abacus: { country: "United Kingdom", note: "the paperback imprint of Little, Brown Book Group UK" },
  AKPress: { country: "United States; United Kingdom", note: "AK Press, Chico and Edinburgh" },
  "Academy of Nutrition & Dietetics": { country: "United States", note: "the American professional body, Chicago" },
  "Alma Classics": { country: "United Kingdom", note: "Alma Books, London" },
  "Barnes & Noble": { country: "United States", note: "the New York bookseller's own editions" },
  "Canterbury Classics": { country: "United States", note: "an imprint of Printers Row Publishing Group, San Diego" },
  "Charles University in Prague, Karolinum Press": { country: "Czech Republic", note: "Karolinum, Prague; ISBN 978-80" },
  "Death's Head Press": { country: "United States", note: "an American horror press" },
  Deutsch: { country: "United Kingdom", note: "André Deutsch, London" },
  "East India Publishing Company": { country: "Canada", note: "ISBN 978-1-77426 is in the Canadian range" },
  "Franklin Library": { country: "United States", note: "Franklin Center, Pennsylvania" },
  Glagoslav: { country: "United Kingdom", note: "Glagoslav Publications, London; ISBN 978-1-909 is in the UK range" },
  "Human Kinetics": { country: "United States", note: "Champaign, Illinois" },
  "Interlink Publishing Group": { country: "United States", note: "Northampton, Massachusetts" },
  "Martino Fine Books": { country: "United States", note: "Eastford, Connecticut" },
  Muchnik: { country: "Spain", note: "Muchnik Editores, Barcelona; ISBN 978-84" },
  "Persea Books": { country: "United States", note: "New York" },
  "Piatkus Books": { country: "United Kingdom", note: "an imprint of Little, Brown Book Group UK" },
  Sutton: { country: "United Kingdom", note: "Sutton Publishing, Stroud" },
  "Text Publishing Company": { country: "Australia", note: "Text Publishing, Melbourne" },
  "Öteki Adam": { country: "Turkey", note: "Turkish publisher; ISBN 978-605" },

  // ── Wikidata items ────────────────────────────────────────────────────────
  "Alfred A. Knopf": {
    accept: "Q1431868",
    note: "the American publishing house founded in 1915; Q55510955 is a bare imprint record",
  },
  "Bloomsbury Publishing": {
    accept: "Q568642",
    note: "Bloomsbury Publishing plc, London; Q138218859 is an empty imprint record",
  },
  "Brill Academic": {
    accept: "Q917031",
    note: "Brill Academic Publishers is Brill of Leiden, the Dutch academic publisher",
  },
  "Carroll & Graf": {
    accept: "Q5046504",
    note: "Carroll & Graf Publishers, New York, 1982-2007",
  },
  "Fortress Press": {
    accept: "Q89377628",
    note: "today's Fortress Press of 1517 Media; Q108595927 is its 1962-1988 predecessor",
  },
  "Snow Lion": {
    accept: "Q1448398",
    note: "Snow Lion Publications, Ithaca, now a Shambhala imprint",
  },
  "SUNY Press": {
    accept: "Q4050071",
    note: "State University of New York Press; SUNY Press is its usual name",
  },
  "Penguin Books": {
    accept: "Q1336200",
    note: "the Penguin Books imprint; Q3374730 is the former Penguin Group company",
  },
  Creation: {
    accept: "Q141243669",
    note: "Creation Books, London (1989-2014): The Bloody Countess, ISBN 978-1-84068; not Creation Records",
  },
  "Flame Tree Press": {
    accept: "Q128925485",
    note: "the horror and fantasy imprint of Flame Tree Publishing, London",
  },
  "Harvill Press": {
    accept: "Q115794862",
    note: "The Harvill Press, London: The Bridge Over the Drina (1994)",
  },
  "Liveright Publishing": {
    accept: "Q116661409",
    note: "Liveright Publishing Corporation, the W. W. Norton imprint: Dom Casmurro (2024)",
  },
  Phoenix: {
    accept: "Q7186801",
    country: "United Kingdom",
    note: "the paperback imprint of Orion: The White Hotel (1999), ISBN 978-0-7538",
  },
  "Portobello Books": {
    accept: "Q50331447",
    note: "Portobello Books, London: The Devil's Workshop (2013)",
  },
  "Random House Publishing Group": {
    reject: true,
    note: "the only candidate, Dell Publishing, carries this name as a stray alias",
  },
  "HarperCollins Publishers": {
    reject: true,
    note: "Wikidata has the global HarperCollins (the group here) and HarperCollins UK; this house is the UK and US publisher",
  },
  Minerva: {
    reject: true,
    note: "the Wikidata item is William Lane's Minerva Press of London (1790s-1820s); this house is the 1990s paperback imprint",
  },
  "Vintage Classics": {
    reject: true,
    note: "the Wikidata item is the American line; this house is the UK imprint of Vintage Publishing",
  },
};
