/** A file this Durtal cannot read at all; `issues` name each place */
export class InterchangeFileError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "InterchangeFileError";
  }
}
