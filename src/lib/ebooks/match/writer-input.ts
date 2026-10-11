/** Plans and receipt snapshots are DTOs. Make a private deep copy before an
 * await; freezing a Date/Map or a caller's top-level object would leave mutable
 * internal state or aliases. Reject accessors, cycles and non-DTO values. */
export function immutableMatchingWriterInput<T>(input: T): T {
  const visiting = new WeakSet<object>();
  const copy = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || value === null || visiting.has(value))
      throw new Error("Matching writer inputs require finite acyclic DTO values");
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null)
      throw new Error("Matching writer inputs cannot contain Date or other mutable internal values");
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string") ||
        (array && (keys.length !== value.length + 1 ||
          Array.from({ length: value.length }, (_, i) => String(i)).some((key) => !Object.hasOwn(value, key)))))
      throw new Error("Matching writer inputs cannot contain sparse, augmented or symbol-keyed values");
    visiting.add(value);
    const result = array ? [] : Object.create(prototype);
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new Error("Matching writer inputs cannot contain accessors or hidden values");
      Object.defineProperty(result, key, { value: copy(descriptor.value), enumerable: true,
        writable: true, configurable: true });
    }
    visiting.delete(value);
    return Object.freeze(result);
  };
  return copy(input) as T;
}
