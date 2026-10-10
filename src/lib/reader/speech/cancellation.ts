/** Tokens cross the asynchronous extractor/native-speaker boundary. */
export interface SpeechToken {
  generation: number;
  utterance: number;
}

export function sameSpeechToken(
  active: SpeechToken | null,
  incoming: SpeechToken,
): boolean {
  return (
    active !== null &&
    active.generation === incoming.generation &&
    active.utterance === incoming.utterance
  );
}

/** Never wrap a generation and accidentally accept work from an earlier open. */
export function nextSpeechGeneration(generation: number): number {
  if (
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    generation === Number.MAX_SAFE_INTEGER
  )
    throw new RangeError("Invalid speech generation");
  return generation + 1;
}
