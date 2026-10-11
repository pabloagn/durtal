/**
 * Browser navigation language allow-lists, checked 2026-10-11 against:
 * https://support.deepl.com/hc/en-us/articles/360019925219-DeepL-Translator-languages
 * https://docs.cloud.google.com/translate/docs/languages (NMT list).
 * Includes the catalogue choices and common ISO codes; unavailable historical
 * languages are never equated with a modern language. No API key or request.
 */
export const DEEPL_SOURCE_LANGUAGES: ReadonlySet<string> = new Set(
  "ar bg ca cs cy da de el en es fi fr ga he hi hr hu it ja ko la nl no pl pt ro ru sa sr sv tr uk zh".split(" "),
);
export const GOOGLE_LANGUAGES: ReadonlySet<string> = new Set(
  "af sq am ar hy az eu be bn bs bg ca ceb zh co hr cs da nl en eo et fi fr fy gl ka de el gu ht ha haw he hi hmn hu is ig id ga it ja jv kn kk km rw ko ku ky lo la lv lt lb mk mg ms ml mt mi mr mn my ne no ny or ps fa pl pt pa ro ru sm sa gd sr st sn sd si sk sl so es su sw sv tl tg ta tt te th tr tk uk ur ug uz vi cy xh yi yo zu".split(" "),
);
