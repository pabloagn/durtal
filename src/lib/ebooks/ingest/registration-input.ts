import { createHash } from "node:crypto";
import { canonicalReviewJson } from "../review/receipts";

/** Registration alone contains Dates. Copy them before the writer's first
 * await, using Date intrinsics rather than caller methods. The tagged hash
 * representation distinguishes a Date from an ordinary metadata object. */
function capture<T>(input: T): { value: T; encoded: unknown } {
  const visiting = new WeakSet<object>();
  const copy = (value: unknown): { value: unknown; encoded: unknown } => {
    if (value === undefined) return { value, encoded: ["undefined"] };
    if (value === null || typeof value === "boolean" || typeof value === "string" ||
        typeof value === "number" && Number.isFinite(value))
      return { value, encoded: ["primitive", value] };
    if (typeof value !== "object" || visiting.has(value))
      throw new Error("Registration requires finite acyclic data");
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Date.prototype) {
      if (Reflect.ownKeys(value).length) throw new Error("Augmented registration Date");
      const ms = Date.prototype.getTime.call(value);
      if (!Number.isFinite(ms)) throw new Error("Invalid registration Date");
      return { value: new Date(ms), encoded: ["date", new Date(ms).toISOString()] };
    }
    const array = Array.isArray(value);
    if (prototype !== (array ? Array.prototype : Object.prototype))
      throw new Error("Registration requires plain objects and arrays");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") || array &&
        (keys.length !== value.length + 1 ||
         Array.from({ length: value.length }, (_, i) => String(i)).some((key) => !Object.hasOwn(value, key))))
      throw new Error("Sparse, augmented or symbol-keyed registration data");
    visiting.add(value);
    const output: Record<string, unknown> | unknown[] = array ? [] : {};
    const entries: [string, unknown][] = [];
    for (const key of keys as string[]) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new Error("Registration cannot contain accessors or hidden data");
      const child = copy(descriptor.value);
      Object.defineProperty(output, key, { value: child.value, enumerable: true });
      entries.push([key, child.encoded]);
    }
    visiting.delete(value);
    return { value: Object.freeze(output), encoded: array
      ? ["array", entries.map((entry) => entry[1])]
      : ["object", entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)] };
  };
  return copy(input) as { value: T; encoded: unknown };
}

export function privateRegistrationInput<T>(input: T): T {
  return capture(input).value;
}
export function registrationInputSha256(input: unknown): string {
  return createHash("sha256").update(canonicalReviewJson(capture(input).encoded)).digest("hex");
}
