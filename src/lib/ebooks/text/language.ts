/*
 * The language of a book's text from its commonest words (SLN-494): English,
 * Spanish, French, German, Italian, Portuguese and Dutch. Anything else, or
 * a text too short or too mixed to tell, gives null and the file's declared
 * language stands.
 */

const STOP_WORDS: Record<string, string> = {
  en: "the and of to in that is was he it for with as his on be at by had not are but from or have an they which you were her she this would there been their what said",
  es: "el la los las del que en y por con para una un es se no lo su como más pero sus le ya fue este ha sí porque esta entre cuando muy sin sobre también me hasta hay donde",
  fr: "le la les des du de et est une un il elle que qui dans pour pas au sur ne se ce avec plus son sa mais comme ou été était nous vous ils leur aux cette",
  de: "der die das und ist nicht ein eine zu den mit sich des auf für im dem von er sie es auch als an nach wie aus bei war wird hat noch aber wenn oder sind",
  it: "il lo la gli le di che e è un una per non con del della si sono ma come nel alla anche più questo era ha al dei delle perché quando così",
  pt: "o os as do da dos das que não em um uma para com por se mais como mas foi ao ele ela seu sua também já está são muito nos quando isso ainda",
  nl: "de het een en van is dat niet op te zijn met voor ook aan er maar om als dan bij nog door naar uit wordt worden heeft hij zij ze wat kan deze geen",
};

const LISTS = Object.entries(STOP_WORDS).map(([code, words]) => ({ code, words: new Set(words.split(" ")) }));

/** Words read: enough to tell, and a long book costs no more than a short one */
const SAMPLE_WORDS = 20_000;
/** At least this share of the words must be the winner's */
const MIN_SHARE = 0.12;
/** And the winner must lead the next language by this factor */
const MIN_LEAD = 1.15;

/** "en", "es", "fr", "de", "it", "pt" or "nl"; null when the text does not tell */
export function detectLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu)?.slice(0, SAMPLE_WORDS) ?? [];
  if (words.length < 50) return null;
  const scores = LISTS.map(({ code, words: list }) => ({
    code,
    hits: words.reduce((n, w) => n + (list.has(w) ? 1 : 0), 0),
  })).sort((a, b) => b.hits - a.hits);
  const [first, second] = scores;
  if (first.hits / words.length < MIN_SHARE) return null;
  if (second && first.hits < second.hits * MIN_LEAD) return null;
  return first.code;
}
