import type { ReaderSpeech } from "@/lib/reader/engine";
import type {
  SpeechPreparation,
  SpeechSegment,
} from "@/lib/reader/speech/player";

/** Plain text enumeration over the concrete bounded Foliate extractor; never speaks or emits SSML. */
export function createFoliateSpeech(input: {
  available(): boolean;
  prepare(request: {
    target: SpeechPreparation;
    signal: AbortSignal;
  }): Promise<{
    current: SpeechSegment | null;
    previous: SpeechSegment | null;
    next: SpeechSegment | null;
  }>;
}): ReaderSpeech {
  return {
    async *segments(from, options) {
      const signal = options?.signal ?? new AbortController().signal;
      signal.throwIfAborted();
      if (!input.available()) return;
      let result = await input.prepare({
        target: { kind: "from", from },
        signal,
      });
      signal.throwIfAborted();
      while (result.current && input.available()) {
        signal.throwIfAborted();
        const current = result.current;
        yield current;
        signal.throwIfAborted();
        if (!input.available()) return;
        const previous = JSON.stringify(current.locator);
        result = await input.prepare({
          target: {
            kind: "adjacent",
            locator: current.locator,
            direction: "next",
          },
          signal,
        });
        signal.throwIfAborted();
        if (result.current && JSON.stringify(result.current.locator) === previous)
          throw new Error("The next speech sentence did not advance.");
      }
    },
  };
}
