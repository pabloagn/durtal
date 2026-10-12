/** StarDict byte parsing only. No worker, decompressor, filesystem or provider I/O. */
export const STARDICT_LIMITS = {
  indexBytes: 256 * 1024 * 1024,
  entries: 5_000_000,
  headwordBytes: 4096,
  entryBytes: 1024 * 1024,
  dictionaryBytes: BigInt(8) * BigInt(1024 ** 3),
  validationBytes: 32 * 1024 * 1024,
  readBytes: 64 * 1024,
  headerBytes: 64 * 1024,
} as const;

export interface StarDictInfo {
  name: string;
  version: "2.4.2" | "3.0.0";
  wordCount: number;
  indexBytes: number;
  offsetBits: 32 | 64;
  synonymCount: number | null;
  types: string | null;
  language: string | null;
}

export interface StarDictByteSource {
  readonly size: number;
  read(
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

export type StarDictLimits = {
  [K in keyof typeof STARDICT_LIMITS]: (typeof STARDICT_LIMITS)[K] extends bigint
    ? bigint
    : number;
};
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const ZERO = BigInt(0);

function fail(message: string): never {
  throw new Error(message);
}
function integer(
  value: string | undefined,
  label: string,
  max: number,
): number {
  if (value === undefined || !/^\d+$/.test(value))
    return fail(`Invalid StarDict ${label}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max)
    return fail(`StarDict ${label} exceeds its limit`);
  return result;
}

function checkedLimits(limits: StarDictLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (typeof value === "bigint") {
      if (value <= ZERO || value > STARDICT_LIMITS.dictionaryBytes)
        fail(`Invalid StarDict ${key} limit`);
    } else if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > Number(STARDICT_LIMITS[key as keyof StarDictLimits])
    )
      fail(`Invalid StarDict ${key} limit`);
  }
}

export function parseStarDictInfo(
  text: string,
  limits: StarDictLimits = STARDICT_LIMITS,
): StarDictInfo {
  checkedLimits(limits);
  if (
    text.length > limits.headerBytes ||
    encoder.encode(text).byteLength > limits.headerBytes
  )
    fail("The StarDict .ifo is too large");
  const [header, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (header !== "StarDict's dict ifo file")
    fail("This is not a StarDict .ifo file");
  const fields = new Map<string, string>();
  for (const line of lines) {
    if (!line) continue;
    const at = line.indexOf("=");
    if (at < 1) fail("Invalid StarDict .ifo field");
    const key = line.slice(0, at);
    if (fields.has(key)) fail(`Duplicate StarDict ${key} field`);
    fields.set(key, line.slice(at + 1));
  }
  const version = fields.get("version");
  if (version !== "2.4.2" && version !== "3.0.0")
    fail("Unsupported StarDict version");
  const name = fields.get("bookname")?.trim();
  if (!name || name.length > 500) fail("Invalid StarDict bookname");
  const offsetBits = integer(
    fields.get("idxoffsetbits") ?? "32",
    "idxoffsetbits",
    64,
  );
  if (offsetBits !== 32 && offsetBits !== 64)
    fail("StarDict idxoffsetbits must be 32 or 64");
  const types = fields.get("sametypesequence") ?? null;
  if (types !== null && !/^[A-Za-z]{1,32}$/.test(types))
    fail("Invalid StarDict sametypesequence");
  return {
    name,
    version,
    wordCount: integer(fields.get("wordcount"), "wordcount", limits.entries),
    indexBytes: integer(
      fields.get("idxfilesize"),
      "idxfilesize",
      limits.indexBytes,
    ),
    offsetBits,
    synonymCount: fields.has("synwordcount")
      ? integer(fields.get("synwordcount"), "synwordcount", limits.entries)
      : null,
    types,
    language: fields.get("lang")?.trim() || null,
  };
}

function folded(byte: number): number {
  return byte >= 65 && byte <= 90 ? byte + 32 : byte;
}
function compare(a: Uint8Array, b: Uint8Array, fold: boolean): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const left = fold ? folded(a[i]) : a[i],
      right = fold ? folded(b[i]) : b[i];
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}

/** g_ascii_strcasecmp first; UTF-8 bytes break ties. No Unicode string lowercasing. */
export function stardictCompare(a: Uint8Array, b: Uint8Array): number {
  return compare(a, b, true) || compare(a, b, false);
}

export interface StarDictIndexEntry {
  headword: string;
  word: Uint8Array;
  offset: bigint;
  size: number;
}

export function validateDictionaryRange(
  offset: bigint,
  size: number,
  dictionaryBytes: bigint,
  limits: StarDictLimits = STARDICT_LIMITS,
) {
  if (
    dictionaryBytes < ZERO ||
    dictionaryBytes > limits.dictionaryBytes ||
    offset < ZERO ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > limits.entryBytes ||
    offset + BigInt(size) > dictionaryBytes
  )
    fail(
      "The dictionary entry is outside the dictionary or exceeds its size limit",
    );
}

export function parseStarDictIndexEntry(
  bytes: Uint8Array,
  offsetBits: 32 | 64,
  limits: StarDictLimits = STARDICT_LIMITS,
): StarDictIndexEntry {
  if (offsetBits !== 32 && offsetBits !== 64)
    fail("Invalid StarDict offset width");
  const end = bytes.indexOf(0);
  const tail = offsetBits / 8 + 4;
  if (end < 1 || end > limits.headwordBytes || bytes.length !== end + 1 + tail)
    fail("Invalid StarDict index entry");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = bytes.slice(0, end);
  let headword: string;
  try {
    headword = decoder.decode(word);
  } catch {
    return fail("A StarDict headword is not valid UTF-8");
  }
  return {
    headword,
    word,
    offset:
      offsetBits === 64
        ? view.getBigUint64(end + 1, false)
        : BigInt(view.getUint32(end + 1, false)),
    size: view.getUint32(end + 1 + offsetBits / 8, false),
  };
}

/** Includes both resident offset arrays and overlapping read/entry/previous-word allocations. */
export function starDictValidationAllocation(
  info: StarDictInfo,
  synonymBytes: number | null,
  limits: StarDictLimits = STARDICT_LIMITS,
) {
  checkedLimits(limits);
  if (
    !Number.isSafeInteger(info.wordCount) ||
    info.wordCount < 0 ||
    info.wordCount > limits.entries ||
    !Number.isSafeInteger(info.indexBytes) ||
    info.indexBytes < 0 ||
    info.indexBytes > limits.indexBytes
  )
    fail("Invalid StarDict index bounds");
  const synCount = synonymBytes === null ? 0 : info.synonymCount;
  if (
    synCount === null ||
    !Number.isSafeInteger(synCount) ||
    synCount < 0 ||
    synCount > limits.entries ||
    (synonymBytes !== null &&
      (!Number.isSafeInteger(synonymBytes) ||
        synonymBytes < 0 ||
        synonymBytes > limits.indexBytes))
  )
    fail("Invalid StarDict synonym bounds");
  if (synonymBytes === null && info.synonymCount)
    fail("The dictionary is missing its .syn file");
  const offsetsBytes =
    (info.wordCount + 1 + (synonymBytes === null ? 0 : synCount + 1)) * 4;
  if (info.offsetBits !== 32 && info.offsetBits !== 64)
    fail("Invalid StarDict offset width");
  if (
    info.wordCount * (2 + info.offsetBits / 8 + 4) > info.indexBytes ||
    (synonymBytes !== null && synCount * 6 > synonymBytes)
  )
    fail("The dictionary entry counts cannot fit in their indexes");
  // Two read windows allow the read result to overlap its predecessor. The
  // remaining reserve includes parser scratch, previous/current/copy keys,
  // UTF-16 decoded strings and decoder scratch, conservatively at 16 bytes
  // per maximum headword byte. No list of decoded words is retained.
  const temporaryBytes =
    limits.readBytes * 2 + (limits.headwordBytes + 13) * 16;
  const totalBytes = offsetsBytes + temporaryBytes;
  if (totalBytes > limits.validationBytes)
    fail("The dictionary indexes exceed the validation memory limit");
  return { offsetsBytes, temporaryBytes, totalBytes };
}

async function scanIndex(
  source: StarDictByteSource,
  count: number,
  tailBytes: number,
  onEntry: (bytes: Uint8Array) => void,
  limits: StarDictLimits,
  signal?: AbortSignal,
) {
  const offsets = new Uint32Array(count + 1);
  const scratch = new Uint8Array(limits.headwordBytes + 1 + tailBytes);
  let length = 0,
    tail = -1,
    entries = 0,
    previous: Uint8Array | null = null;
  for (let at = 0; at < source.size; at += limits.readBytes) {
    signal?.throwIfAborted();
    const amount = Math.min(limits.readBytes, source.size - at);
    const block = await source.read(at, amount, signal);
    signal?.throwIfAborted();
    if (block.length !== amount)
      fail("The dictionary index ended unexpectedly");
    for (let n = 0; n < block.length; n++) {
      if (length >= scratch.length)
        fail("The dictionary headword exceeds its size limit");
      const byte = block[n];
      scratch[length++] = byte;
      if (tail < 0) {
        if (byte === 0) {
          if (length === 1) fail("The dictionary index has an empty headword");
          tail = tailBytes;
        } else if (length > limits.headwordBytes)
          fail("The dictionary headword exceeds its size limit");
      } else if (--tail === 0) {
        if (entries >= count)
          fail("The dictionary index has more entries than its .ifo");
        const entry = scratch.subarray(0, length);
        const word = entry.slice(0, length - tailBytes - 1);
        try {
          decoder.decode(word);
        } catch {
          fail("A StarDict headword is not valid UTF-8");
        }
        if (previous && stardictCompare(previous, word) > 0)
          fail("The dictionary index is not in StarDict byte order");
        offsets[entries++] = at + n + 1 - length;
        onEntry(entry);
        previous = word;
        length = 0;
        tail = -1;
      }
    }
  }
  if (length !== 0 || entries !== count)
    fail("The dictionary index does not match its .ifo entry count");
  offsets[count] = source.size;
  return offsets;
}

export async function buildStarDictOffsets(input: {
  info: StarDictInfo;
  index: StarDictByteSource;
  synonyms?: StarDictByteSource;
  dictionaryBytes: bigint;
  limits?: StarDictLimits;
  signal?: AbortSignal;
}) {
  const { info, index, synonyms, signal } = input;
  signal?.throwIfAborted();
  const limits = input.limits ?? STARDICT_LIMITS;
  const allocation = starDictValidationAllocation(
    info,
    synonyms?.size ?? null,
    limits,
  );
  validateDictionaryRange(ZERO, 0, input.dictionaryBytes, limits);
  if (index.size !== info.indexBytes)
    fail(
      `This .idx does not match its .ifo: ${info.indexBytes} bytes expected, ${index.size} found`,
    );
  const offsets = await scanIndex(
    index,
    info.wordCount,
    info.offsetBits / 8 + 4,
    (bytes) => {
      const entry = parseStarDictIndexEntry(bytes, info.offsetBits, limits);
      validateDictionaryRange(
        entry.offset,
        entry.size,
        input.dictionaryBytes,
        limits,
      );
    },
    limits,
    signal,
  );
  const synOffsets = synonyms
    ? await scanIndex(
        synonyms,
        info.synonymCount!,
        4,
        (bytes) => {
          const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          );
          if (view.getUint32(bytes.length - 4, false) >= info.wordCount)
            fail("A dictionary synonym points outside the index");
        },
        limits,
        signal,
      )
    : null;
  return { offsets, synOffsets, allocation };
}

async function indexEntry(
  source: StarDictByteSource,
  offsets: Uint32Array,
  at: number,
  bits: 32 | 64,
  limits: StarDictLimits,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const start = offsets[at],
    end = offsets[at + 1];
  if (
    end <= start ||
    end > source.size ||
    end - start > limits.headwordBytes + 13
  )
    fail("Invalid dictionary offset index");
  const bytes = await source.read(start, end - start, signal);
  signal?.throwIfAborted();
  if (bytes.length !== end - start)
    fail("The dictionary index ended unexpectedly");
  return parseStarDictIndexEntry(bytes, bits, limits);
}

/** Exact bytes first; if absent, the ASCII-case-insensitive equivalent range. */
export async function searchStarDictIndex(
  source: StarDictByteSource,
  offsets: Uint32Array,
  word: string,
  bits: 32 | 64,
  options: { signal?: AbortSignal; limits?: StarDictLimits } = {},
) {
  options.signal?.throwIfAborted();
  const limits = options.limits ?? STARDICT_LIMITS;
  const wanted = encoder.encode(word);
  if (
    wanted.length === 0 ||
    wanted.length > limits.headwordBytes ||
    offsets.length < 1 ||
    offsets.length > limits.entries + 1 ||
    offsets[offsets.length - 1] !== source.size
  )
    fail("Invalid dictionary search bounds");
  const load = (at: number) =>
    indexEntry(source, offsets, at, bits, limits, options.signal);
  async function find(fold: boolean) {
    let low = 0,
      high = offsets.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const entry = await load(mid);
      const order = fold
        ? compare(entry.word, wanted, true)
        : stardictCompare(entry.word, wanted);
      if (order < 0) low = mid + 1;
      else high = mid;
    }
    const entries: StarDictIndexEntry[] = [];
    for (let at = low; at < offsets.length - 1; at++) {
      const entry = await load(at);
      if (
        (fold
          ? compare(entry.word, wanted, true)
          : compare(entry.word, wanted, false)) !== 0
      )
        break;
      if (entries.length >= 200)
        fail("Too many dictionary entries share this headword");
      entries.push(entry);
    }
    return entries;
  }
  const exact = await find(false);
  return exact.length ? exact : find(true);
}

/** Check generated little-endian arrays once when opening a pack, never on every search. */
export function validateStarDictOffsets(
  offsets: Uint32Array,
  sourceBytes: number,
  count: number,
  limits: StarDictLimits = STARDICT_LIMITS,
) {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > limits.entries ||
    !Number.isSafeInteger(sourceBytes) ||
    sourceBytes < 0 ||
    sourceBytes > limits.indexBytes ||
    offsets.length !== count + 1 ||
    offsets[0] !== 0 ||
    offsets[count] !== sourceBytes
  )
    fail("Invalid dictionary offset index");
  for (let at = 0; at < count; at++) {
    if (
      offsets[at + 1] <= offsets[at] ||
      offsets[at + 1] - offsets[at] > limits.headwordBytes + 13
    )
      fail("Invalid dictionary offset index");
  }
}

export async function searchStarDictSynonyms(
  source: StarDictByteSource,
  offsets: Uint32Array,
  word: string,
  wordCount: number,
  options: { signal?: AbortSignal; limits?: StarDictLimits } = {},
) {
  options.signal?.throwIfAborted();
  const limits = options.limits ?? STARDICT_LIMITS;
  const wanted = encoder.encode(word);
  if (
    !wanted.length ||
    wanted.length > limits.headwordBytes ||
    offsets.length < 1 ||
    offsets.length > limits.entries + 1 ||
    offsets[offsets.length - 1] !== source.size ||
    !Number.isSafeInteger(wordCount) ||
    wordCount < 0 ||
    wordCount > limits.entries
  )
    fail("Invalid dictionary synonym search bounds");
  async function load(at: number) {
    options.signal?.throwIfAborted();
    const start = offsets[at],
      end = offsets[at + 1];
    if (
      end <= start ||
      end > source.size ||
      end - start > limits.headwordBytes + 5
    )
      fail("Invalid synonym offset index");
    const bytes = await source.read(start, end - start, options.signal);
    options.signal?.throwIfAborted();
    const nul = bytes.indexOf(0);
    if (bytes.length !== end - start || nul < 1 || bytes.length !== nul + 5)
      fail("Invalid dictionary synonym entry");
    const index = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(nul + 1, false);
    if (index >= wordCount)
      fail("A dictionary synonym points outside the index");
    const word = bytes.subarray(0, nul);
    try {
      decoder.decode(word);
    } catch {
      fail("A dictionary synonym is not valid UTF-8");
    }
    return { word, index };
  }
  async function find(fold: boolean) {
    let low = 0,
      high = offsets.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2),
        entry = await load(mid);
      if (
        (fold
          ? compare(entry.word, wanted, true)
          : stardictCompare(entry.word, wanted)) < 0
      )
        low = mid + 1;
      else high = mid;
    }
    const indices = new Set<number>();
    for (let at = low; at < offsets.length - 1; at++) {
      const entry = await load(at);
      if (compare(entry.word, wanted, fold) !== 0) break;
      if (at - low >= 200)
        fail("Too many dictionary synonyms share this headword");
      indices.add(entry.index);
    }
    return [...indices];
  }
  const exact = await find(false);
  return exact.length ? exact : find(true);
}

export interface DictzipHeader {
  chunkLength: number;
  uncompressedBytes: bigint;
  chunks: { offset: number; size: number }[];
}

export function parseDictzipHeader(
  prefix: Uint8Array,
  fileBytes: number,
  tail: Uint8Array,
  limits: StarDictLimits = STARDICT_LIMITS,
): DictzipHeader {
  if (
    !Number.isSafeInteger(fileBytes) ||
    fileBytes < 20 ||
    prefix.length > limits.headerBytes ||
    tail.length !== 10 ||
    tail[0] !== 3 ||
    tail[1] !== 0 ||
    prefix.length < 12 ||
    prefix[0] !== 31 ||
    prefix[1] !== 139 ||
    prefix[2] !== 8 ||
    (prefix[3] & 4) === 0 ||
    (prefix[3] & 224) !== 0
  )
    fail("This .dict.dz is not a supported dictzip file");
  const view = new DataView(
    prefix.buffer,
    prefix.byteOffset,
    prefix.byteLength,
  );
  const extraEnd = 12 + view.getUint16(10, true);
  if (extraEnd > prefix.length) fail("The dictzip extra header is truncated");
  let chunkLength = 0,
    lengths: number[] | null = null;
  for (let at = 12; at < extraEnd; ) {
    if (at + 4 > extraEnd) fail("Invalid dictzip extra field");
    const size = view.getUint16(at + 2, true),
      end = at + 4 + size;
    if (end > extraEnd) fail("Invalid dictzip extra field size");
    if (prefix[at] === 82 && prefix[at + 1] === 65) {
      if (lengths || size < 6 || view.getUint16(at + 4, true) !== 1)
        fail("Invalid dictzip RA field");
      chunkLength = view.getUint16(at + 6, true);
      const count = view.getUint16(at + 8, true);
      if (chunkLength === 0 || count === 0 || size !== 6 + count * 2)
        fail("Invalid dictzip chunk table");
      lengths = Array.from({ length: count }, (_, i) =>
        view.getUint16(at + 10 + i * 2, true),
      );
      if (lengths.some((length) => length === 0))
        fail("Invalid dictzip compressed chunk size");
    }
    at = end;
  }
  if (!lengths) fail("The .dict.dz has no dictzip RA field");
  let dataAt = extraEnd;
  for (const flag of [8, 16])
    if (prefix[3] & flag) {
      while (dataAt < prefix.length && prefix[dataAt] !== 0) dataAt++;
      if (dataAt >= prefix.length)
        fail("The dictzip name or comment is truncated");
      dataAt++;
    }
  if (prefix[3] & 2) dataAt += 2;
  if (dataAt > prefix.length) fail("The dictzip header is truncated");
  const chunks = lengths.map((size) => {
    const offset = dataAt;
    dataAt += size;
    return { offset, size };
  });
  // The RA table covers full-flush chunks; Z_FINISH emits a separate empty
  // final deflate block (03 00) before the eight-byte gzip footer.
  if (dataAt !== fileBytes - 10)
    fail("The dictzip chunk table does not match its file size");
  const uncompressed = new DataView(
    tail.buffer,
    tail.byteOffset,
    tail.byteLength,
  ).getUint32(6, true);
  if (
    uncompressed > lengths.length * chunkLength ||
    uncompressed < (lengths.length - 1) * chunkLength ||
    BigInt(uncompressed) > limits.dictionaryBytes
  )
    fail("The dictzip uncompressed size does not match its chunk table");
  return { chunkLength, uncompressedBytes: BigInt(uncompressed), chunks };
}

export function dictzipEntryChunks(
  header: DictzipHeader,
  offset: bigint,
  size: number,
  limits: StarDictLimits = STARDICT_LIMITS,
) {
  if (
    !Number.isSafeInteger(header.chunkLength) ||
    header.chunkLength <= 0 ||
    header.chunkLength > 65535
  )
    fail("Invalid dictzip chunk length");
  validateDictionaryRange(offset, size, header.uncompressedBytes, limits);
  if (!size) return [];
  const first = Number(offset / BigInt(header.chunkLength)),
    last = Number(
      (offset + BigInt(size) - BigInt(1)) / BigInt(header.chunkLength),
    );
  if (last - first >= 1024 || last >= header.chunks.length)
    fail("The dictionary entry spans too many chunks");
  return header.chunks
    .slice(first, last + 1)
    .map((chunk, i) => ({ ...chunk, index: first + i }));
}

const DISPLAY_TYPES = new Set("mltyhgx");
export function parseStarDictEntry(
  bytes: Uint8Array,
  types: string | null,
  limits: StarDictLimits = STARDICT_LIMITS,
): { type: string; text: string }[] {
  if (
    bytes.length > limits.entryBytes ||
    (types !== null && !/^[A-Za-z]{1,32}$/.test(types))
  )
    fail("Invalid dictionary entry bounds or type sequence");
  const parts: { type: string; text: string }[] = [];
  let at = 0,
    sequence = 0,
    visited = 0;
  while (types !== null ? sequence < types.length : at < bytes.length) {
    if (++visited > 4096) fail("The dictionary entry has too many parts");
    const type =
      types === null ? String.fromCharCode(bytes[at++]) : types[sequence++];
    if (!/^[A-Za-z]$/.test(type)) fail("Invalid dictionary entry type");
    let end: number,
      contentAt = at;
    if (types !== null && sequence === types.length) end = bytes.length;
    else if (type === type.toLowerCase()) {
      end = bytes.indexOf(0, at);
      if (end < 0) fail("The dictionary text part is unterminated");
    } else {
      if (at + 4 > bytes.length)
        fail("The dictionary binary part is truncated");
      const size = new DataView(
        bytes.buffer,
        bytes.byteOffset + at,
        4,
      ).getUint32(0, false);
      contentAt += 4;
      end = contentAt + size;
      if (end > bytes.length)
        fail("The dictionary binary part is outside the entry");
    }
    if (DISPLAY_TYPES.has(type)) {
      if (parts.length >= 32)
        fail("The dictionary entry has too many display parts");
      try {
        parts.push({
          type,
          text: decoder.decode(bytes.subarray(contentAt, end)),
        });
      } catch {
        fail("The dictionary text is not valid UTF-8");
      }
    }
    at =
      end +
      (types !== null && sequence === types.length
        ? 0
        : type === type.toLowerCase()
          ? 1
          : 0);
  }
  if (at !== bytes.length)
    fail("The dictionary entry does not match its type sequence");
  return parts;
}
