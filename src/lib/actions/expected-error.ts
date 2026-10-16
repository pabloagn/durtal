/** A deliberate, user-facing refusal. Never use for infrastructure failures. */
export class ExpectedActionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExpectedActionError";
  }
}
