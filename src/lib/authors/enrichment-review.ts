/**
 * Author enrichment decisions made after research, by author slug. Each
 * accepts the Wikidata person the rules held back, refuses the person they
 * chose, marks an author as another author twice, keeps a fact Wikidata has
 * wrong from being filled, or puts a broken sort name right. Each says why.
 */
import type { AuthorReviewDecision } from "@/lib/authors/enrichment";

export const AUTHOR_REVIEW: Record<string, AuthorReviewDecision> = {
  // ── The same person twice: merge them in the app ─────────────────────────
  calvino: {
    name: "Calvino",
    duplicateOf: "italo-calvino",
    note: "Italo Calvino, who has his own record with another book; merge this one into it",
  },
  "mcewan-ianrussell": {
    name: "McEwan,IanRussell",
    duplicateOf: "ian-mcewan",
    note: "“Ian Russell McEwan” written as one word; its book, Atonement, is Ian McEwan's",
  },

  // ── People the rules held back, accepted after research ──────────────────
  homer: {
    name: "Homer",
    accept: "Q6691",
    skip: ["deathPlace"],
    note: "the poet of the Iliad and the Odyssey; Wikidata files him as a human who may be fictional, and his death on Ios is a legend",
  },
  "moses-de-leon": {
    name: "Moses de León",
    accept: "Q456758",
    note: "Moses de León (Moshé de León), the 13th-century Spanish rabbi to whom the Zohar is attributed",
  },
  "henri-alain-fournier": {
    name: "Henri Alain-Fournier",
    accept: "Q298394",
    rename: { sort_name: "Alain-Fournier, Henri", first_name: "Henri", last_name: "Alain-Fournier" },
    note: "Alain-Fournier, author of Le Grand Meaulnes (The Lost Estate), the other matches are namesakes; the sort name was “Fournier, Henri Alain”, but the pen name Alain-Fournier is one family name",
  },
  "eca-de-queiros": {
    name: "Eça de Queirós",
    accept: "Q316327",
    note: "José Maria de Eça de Queirós, author of Os Maias (The Maias)",
  },
  "luis-martin-santos": {
    name: "Luis Martín-Santos",
    accept: "Q1381427",
    skip: ["realName"],
    note: "the Spanish writer and psychiatrist, author of Tiempo de silencio (Time of Silence); Wikidata's birth name “Luis Martin Ribera” drops the Santos of Martín-Santos Ribera",
  },
  "makiya-kanan": {
    name: "Makiya, Kanan",
    accept: "Q2897015",
    rename: { sort_name: "Makiya, Kanan", first_name: "Kanan", last_name: "Makiya" },
    note: "Kanan Makiya, author of Republic of Fear; the sort name was “Kanan, Makiya,”, and the inverted display name is renamed in the app",
  },
  "mary-beard": {
    name: "Mary Beard",
    accept: "Q458403",
    note: "the English classicist, author of Twelve Caesars; the other matches are namesakes",
  },
  "bothayna-al-essa": {
    name: "Bothayna Al-Essa",
    accept: "Q6741658",
    correct: { birth: { month: 9, day: 3 } },
    note: "Kuwaiti novelist, author of The Book Censor's Library, born 3 September 1982 (Wikidata and Wikipedia); the catalogue had the 18th",
  },
  "christopher-zeischegg": {
    name: "Christopher Zeischegg",
    accept: "Q15117241",
    correct: { birth: { year: 1985, month: 10, day: 21 } },
    skip: ["bio"],
    note: "Danny Wylde is his stage name; he wrote The Magician (2020) and was born on 21 October 1985 (Wikidata and Wikipedia), not in 1984; Wikidata describes only his acting, so no About text",
  },

  "marla-segol": {
    name: "Marla Segol",
    accept: "Q113846212",
    note: "the only Marla Segol on Wikidata, a religious studies and Judaic scholar: the author of Kabbalah and Sex Magic",
  },
  "melanie-hawthorne": {
    name: "Melanie Hawthorne",
    accept: "Q131772480",
    note: "the only Melanie Hawthorne on Wikidata, a scholar of French: the translator and editor of Rachilde's Monsieur Vénus",
  },
  "charles-d-ciccone": {
    name: "Charles D. Ciccone",
    accept: "Q112487965",
    note: "the only Charles D. Ciccone on Wikidata, a physiotherapist: the author of Pharmacology in Rehabilitation",
  },

  // ── No Wikidata person is this author ────────────────────────────────────
  "donald-a-neumann": {
    name: "Donald A. Neumann",
    reject: true,
    note: "the Wikidata Donald Neumann is an economist; the kinesiology author is a physical therapist",
  },
  anonymous: { name: "Anonymous", reject: true, note: "the tales have no single author" },
  "unknown-unknown": { name: "Unknown Unknown", reject: true, note: "the Picatrix's author is unknown" },
  "luther-blissett": {
    name: "Luther Blissett",
    reject: true,
    note: "a collective pseudonym of Italian writers (Wu Ming), not the footballer",
  },
  "melissa-brown": {
    name: "Melissa Brown",
    reject: true,
    note: "the sports nutrition author is none of the Wikidata people of that name",
  },

  // ── Facts Wikidata has wrong ─────────────────────────────────────────────
  "ian-mcewan": {
    name: "Ian McEwan",
    skip: ["realName"],
    note: "Wikidata's birth name has a typo (“Russel”); his middle name is Russell",
  },
  "john-steinbeck": {
    name: "John Steinbeck",
    skip: ["realName"],
    note: "Wikidata's birth name “Jeffery Ernest Steinbeck” is wrong; he was born John Ernst Steinbeck",
  },
  "aldous-huxley": {
    name: "Aldous Huxley",
    skip: ["realName"],
    note: "Wikidata's birth name adds his mother's family name Arnold; he was Aldous Leonard Huxley",
  },
  "dante-alighieri": {
    name: "Dante Alighieri",
    skip: ["realName"],
    note: "Wikidata's birth name “Dante da Alaghiero degli Alaghieri” is an unusual form; the common one is Durante di Alighiero degli Alighieri",
  },
  "marcus-aurelius": {
    name: "Marcus Aurelius",
    skip: ["realName"],
    note: "his birth name is given in several forms (Marcus Annius Verus is the usual one); Wikidata's is not it",
  },
  "petronius-arbiter": {
    name: "Petronius Arbiter",
    skip: ["realName"],
    note: "Wikidata's birth name “Publius Petronius Niger” is a scholar's guess, not a known fact",
  },

  // ── Values put right, each checked against English Wikipedia ─────────────
  "denis-johnson": {
    name: "Denis Johnson",
    correct: { birth: { month: 7, day: 1 } },
    note: "born 1 July 1949 (Wikidata and Wikipedia); the catalogue had the 6th",
  },
  "marina-dyachenko": {
    name: "Marina Dyachenko",
    correct: { birth: { month: 1, day: 23 } },
    note: "born 23 January 1968 (Wikidata and Wikipedia); the catalogue had the 18th",
  },
  "patrick-mcgrath": {
    name: "Patrick McGrath",
    correct: { birth: { month: 2, day: 7 } },
    note: "born 7 February 1950 (Wikidata and Wikipedia); the catalogue had the 17th",
  },
  "imre-madach": {
    name: "Imre Madách",
    correct: { birth: { month: 1 } },
    note: "born 20 January 1823 (Wikipedia, as the catalogue); Wikidata's 21st is wrong, so only the month is added",
  },
  "marguerite-young": {
    name: "Marguerite Young",
    correct: { birth: { month: 8 } },
    note: "born 26 August 1908 (Wikipedia, as the catalogue); Wikidata's 28th is wrong, so only the month is added",
  },
  "patrick-senecal": {
    name: "Patrick Senécal",
    correct: { nationality: "CA" },
    note: "a French-Canadian writer born in Drummondville, Quebec (Wikidata and Wikipedia); the catalogue had France",
  },

  // ── Broken sort names ────────────────────────────────────────────────────
  "christopher-r-browning": {
    name: "Christopher R. Browning",
    rename: { sort_name: "Browning, Christopher R." },
    note: "the sort name was “R., Browning, Christopher”",
  },
  "graham-greene": {
    name: "Graham Greene",
    rename: { sort_name: "Greene, Graham", first_name: "Graham", last_name: "Greene" },
    note: "the sort name was “Graham, Greene,”: given and family name swapped",
  },
  "manuel-mujica-lainez": {
    name: "Manuel Mujica Lainez",
    rename: { sort_name: "Mujica Lainez, Manuel", first_name: "Manuel", last_name: "Mujica Lainez" },
    note: "the sort name was “Lainez, Manuel Mujica”: Mujica Lainez is a two-part family name",
  },
  "horacio-castellanos-moya": {
    name: "Horacio Castellanos Moya",
    rename: { sort_name: "Castellanos Moya, Horacio", first_name: "Horacio", last_name: "Castellanos Moya" },
    note: "the sort name was “Moya, Horacio Castellanos”: Castellanos Moya is a two-part family name",
  },
  "sergio-de-la-pava": {
    name: "Sergio De La Pava",
    rename: { sort_name: "De La Pava, Sergio", first_name: "Sergio", last_name: "De La Pava" },
    note: "the sort name was “Pava, Sergio De La”: his family name is De La Pava",
  },
  "yan-lianke": {
    name: "Yan Lianke",
    rename: { sort_name: "Yan, Lianke", first_name: "Lianke", last_name: "Yan" },
    note: "the sort name was “Lianke, Yan”: Yan is the family name, written first in Chinese",
  },
  "yan-mo": {
    name: "Yan Mo",
    rename: { sort_name: "Mo, Yan", first_name: "Yan", last_name: "Mo" },
    note: "the pen name is Mo Yan (Mo first); the display name is renamed in the app",
  },
  "dasa-drndic": {
    name: "Daša Drndic",
    rename: { sort_name: "Drndić, Daša", first_name: "Daša", last_name: "Drndić" },
    note: "the family name is Drndić; the display name is renamed in the app",
  },
};
