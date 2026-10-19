/**
 * A deliberate refusal, unwrapped on the client from an action's result: its
 * message is written for the screen. Any other error thrown by a server
 * action carries Next's generic production sentence instead.
 */
export class ActionRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRefusal";
  }
}
