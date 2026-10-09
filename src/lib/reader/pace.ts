import type { EngineEvents } from "./engine";
export interface PaceLanguage {
  cpm: number;
  samples: number;
  updatedAt: number;
}
type PaceStore = { v: 1; languages: Record<string, PaceLanguage> };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export const paceLanguage = (language: string | null) =>
  language?.split("-")[0].toLowerCase() || "und";

/** Dwell samples are local estimates; this module knows no transport or reader event bus. */
export class PaceModel {
  #store: PaceStore = { v: 1, languages: {} };
  #page: { at: number; relocation: EngineEvents["relocate"] } | null = null;
  constructor(
    private readonly storage: StorageLike | null,
    private readonly now = Date.now,
  ) {
    try {
      const raw = JSON.parse(
        storage?.getItem("durtal-reader-pace") ?? "null",
      ) as PaceStore | null;
      if (raw?.v === 1 && raw.languages && typeof raw.languages === "object") {
        for (const [language, sample] of Object.entries(raw.languages)) {
          if (
            Number.isFinite(sample.cpm) &&
            sample.cpm >= 200 &&
            sample.cpm <= 5000 &&
            Number.isInteger(sample.samples) &&
            sample.samples > 0 &&
            Number.isFinite(sample.updatedAt)
          )
            this.#store.languages[language] = sample;
        }
      }
    } catch {
      /* In-memory estimates work without storage. */
    }
  }
  get(language: string | null) {
    return this.#store.languages[paceLanguage(language)] ?? null;
  }
  interrupt() {
    this.#page = null;
  }
  arrive(
    relocation: EngineEvents["relocate"],
    language: string | null,
    visible = true,
  ) {
    if (
      relocation.reason === "layout" ||
      (relocation.origin && relocation.origin !== "human")
    ) {
      this.interrupt();
      return false;
    }
    const previous = this.#page;
    const at = this.now();
    this.#page =
      visible && relocation.linear && relocation.paginated
        ? { at, relocation }
        : null;
    if (
      !previous ||
      !visible ||
      relocation.reason !== "turn" ||
      !relocation.linear ||
      !relocation.paginated ||
      relocation.locator.totalProgression <=
        previous.relocation.locator.totalProgression ||
      previous.relocation.visibleChars < 200
    )
      return false;
    const dwell = at - previous.at;
    if (dwell < 5000 || dwell > 90000) return false;
    const sample = Math.max(
      200,
      Math.min(5000, (previous.relocation.visibleChars * 60000) / dwell),
    );
    const key = paceLanguage(language);
    const old = this.#store.languages[key];
    this.#store.languages[key] = {
      cpm: old ? 0.1 * sample + 0.9 * old.cpm : sample,
      samples: (old?.samples ?? 0) + 1,
      updatedAt: at,
    };
    try {
      this.storage?.setItem("durtal-reader-pace", JSON.stringify(this.#store));
    } catch {
      /* Local fallback. */
    }
    return true;
  }
  remaining(
    language: string | null,
    characters: number,
    kind: "chapter" | "book",
  ) {
    const pace = this.get(language);
    return !pace || pace.samples < 5
      ? "Learning your pace"
      : formatTimeLeft(characters / pace.cpm, kind);
  }
}
export function formatTimeLeft(minutes: number, kind: "chapter" | "book") {
  const suffix = " left in " + kind;
  if (minutes < 1) return "Less than a minute" + suffix;
  const whole = Math.ceil(minutes);
  return (
    (whole < 60
      ? whole + " min"
      : Math.floor(whole / 60) +
        " h" +
        (whole % 60 ? " " + (whole % 60) + " min" : "")) + suffix
  );
}
