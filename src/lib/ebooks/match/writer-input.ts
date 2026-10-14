/** Every object built below: a deeply frozen, checked DTO that can never
 * change, so a later call shares it instead of copying it again. A review
 * plan on 6,000 eBooks holds about 30 MB of rows, and each copy took most of
 * a second (SLN-691). */
const sealed = new WeakSet<object>();
/** Plans and receipt snapshots are DTOs. Make a private deep copy before an
 * await; freezing a Date/Map or a caller's top-level object would leave mutable
 * internal state or aliases. Reject accessors, cycles and non-DTO values. */
export function immutableMatchingWriterInput<T>(input: T): T {
  const visiting = new WeakSet<object>();
  const copy = (value: unknown): unknown => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "object" && value !== null && sealed.has(value)) return value;
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
    const frozen = Object.freeze(result);
    sealed.add(frozen);
    return frozen;
  };
  return copy(input) as T;
}
/** Seals values fresh from JSON.parse, such as rows a query just read, in
 * place rather than copying them: nothing else holds them yet, and parsed
 * JSON has no accessors, symbols, holes or other prototypes. About a sixth
 * of the copy's cost on 6,000 eBooks. Values a copy would refuse are refused,
 * but only a caller holding the parsed result may use it. */
export function sealParsedJson<T>(input: T): T {
  const visiting = new WeakSet<object>();
  const seal = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || visiting.has(value))
      throw new Error("Only parsed JSON can be sealed in place");
    if (sealed.has(value)) return;
    visiting.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) seal(value[i]);
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length)
        throw new Error("Only parsed JSON can be sealed in place");
      for (const key of Object.keys(value)) seal((value as Record<string, unknown>)[key]);
    }
    visiting.delete(value);
    sealed.add(Object.freeze(value));
  };
  seal(input);
  return input;
}
