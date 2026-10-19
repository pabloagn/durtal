/** A deliberate, user-facing refusal. Never use for infrastructure failures. */
export class ExpectedActionError extends Error {
  /** A page that settles the refusal, such as the book that holds an ISBN */
  readonly href?: string;
  constructor(message: string, options?: ErrorOptions & { href?: string }) {
    super(message, options);
    this.name = "ExpectedActionError";
    if (options?.href) this.href = options.href;
  }
}
