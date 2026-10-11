export interface CachedRangePlan {
  status: 200 | 206 | 416;
  start: number;
  endExclusive: number;
  body: boolean;
  headers: Record<string, string>;
}
/** Only plans headers and a Blob slice; it does not read/cache file bytes. */
export function cachedRangePolicy(input: {
  method: "GET" | "HEAD";
  range: string | null;
  ifRange?: string | null;
  sizeBytes: number;
  sha256: string;
  contentType: string;
}): CachedRangePlan {
  const { sizeBytes, sha256, contentType } = input;
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !contentType ||
    /[\u0000-\u001f\u007f]/.test(contentType)
  )
    throw new Error("Invalid cached file headers");
  const headers = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    ETag: `"${sha256}"`,
  };
  const result = (
    status: 200 | 206 | 416,
    start: number,
    endExclusive: number,
    extra: Record<string, string> = {},
  ): CachedRangePlan => ({
    status,
    start,
    endExclusive,
    body: input.method === "GET" && status !== 416,
    headers: {
      ...headers,
      "Content-Length": String(endExclusive - start),
      ...extra,
    },
  });
  const full = () => result(200, 0, sizeBytes);
  // HTTP Range applies to GET. Dates cannot validate an immutable SHA-256 ETag.
  if (
    input.method === "HEAD" ||
    !input.range ||
    (input.ifRange && input.ifRange !== headers.ETag) ||
    input.range.includes(",") ||
    input.range.length > 1024
  )
    return full();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(input.range.trim());
  if (!match || (!match[1] && !match[2])) return full();
  const size = BigInt(sizeBytes);
  const unsatisfiable = () =>
    result(416, 0, 0, { "Content-Range": `bytes */${sizeBytes}` });
  if (!sizeBytes) return unsatisfiable();
  let start: bigint, end: bigint;
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === BigInt(0)) return unsatisfiable();
    start = suffix >= size ? BigInt(0) : size - suffix;
    end = size - BigInt(1);
  } else {
    start = BigInt(match[1]);
    end = match[2] ? BigInt(match[2]) : size - BigInt(1);
    if (start >= size || end < start) return unsatisfiable();
    if (end >= size) end = size - BigInt(1);
  }
  return result(206, Number(start), Number(end + BigInt(1)), {
    "Content-Range": `bytes ${start}-${end}/${sizeBytes}`,
  });
}
