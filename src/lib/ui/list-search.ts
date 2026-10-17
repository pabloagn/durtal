/** List-search owners clear their draft and cancel pending work before navigation. */
export const CLEAR_LIST_SEARCH = "durtal:clear-list-search";

export function clearListSearch(input: HTMLInputElement, navigate = true) {
  input.value = "";
  input.dispatchEvent(new CustomEvent(CLEAR_LIST_SEARCH, { detail: { navigate } }));
  input.focus({ preventScroll: true });
}

const shown = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0;

export function listSearchField(scope: ParentNode = document): HTMLInputElement | null {
  return [...scope.querySelectorAll<HTMLInputElement>('[data-list-focus="search"]')].find(shown) ?? null;
}

/** Leaving an empty search keeps focus on its list, never on the document body. */
export function leaveListSearch(input: HTMLInputElement) {
  const scope = input.closest("main") ?? document;
  const filter = [...scope.querySelectorAll<HTMLElement>('[data-list-focus="filters"]')].find(shown);
  const heading = scope.querySelector<HTMLElement>("h1");
  const target = filter ?? heading;
  if (target) {
    if (target === heading && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
}
