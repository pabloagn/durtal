/**
 * What the place search and place details say when Google refuses the
 * request (SLN-424): a refused key and a spent quota each get their own
 * message, so the search shows why it is empty instead of an empty list.
 * The routes log Google's status and answer either way.
 */
export function placesRefusal(status: number): { status: number; error: string } | null {
  if (status === 403)
    return { status: 503, error: "Google Places refused the key. Check it in Settings, Integrations." };
  if (status === 429)
    return { status: 503, error: "Google Places is over its quota. Try again later." };
  return null;
}
