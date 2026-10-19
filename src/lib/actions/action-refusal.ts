/**
 * A deliberate refusal the server sent as data (`actionResult`), raised again
 * on the client by the UI adapters (`catalogue-client`, `taxonomy-client`).
 * Its message is written for the screen. Any other error thrown by a server
 * action carries Next's generic production sentence instead.
 */
export class ActionRefusal extends Error {
  /** A page that settles the refusal, when the server named one */
  readonly href?: string;
  constructor(message: string, href?: string) {
    super(message);
    this.name = "ActionRefusal";
    if (href) this.href = href;
  }
}
