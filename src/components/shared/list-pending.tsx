"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Spinner } from "@/components/ui/spinner";

/**
 * A list's wait while its results load: the books list's loading screen, its
 * own wait and every search below share it, so all searches look alike.
 */
export function ListPending() {
  return (
    <div className="py-16">
      <Spinner />
    </div>
  );
}

interface ListBusy {
  busy: boolean;
  /** The query changed and will be sent: the list is busy from now */
  begin: () => void;
  /** Run a navigation; the list stays busy until its results are in */
  navigate: (go: () => void) => void;
}

const ListBusyContext = createContext<ListBusy | null>(null);

/**
 * The controls that take focus if the one that started a wait is gone when
 * the results are in (SLN-838), nearest first. In a `data-focus-group` (the
 * active filter chips) a removed `data-focus-item` hands focus to the next
 * item, or the previous one when it was the last.
 */
function focusSuccessors(control: Element | null): Element[] {
  const group = control?.closest("[data-focus-group]");
  if (!control || !group) return [];
  const items = [...group.querySelectorAll("[data-focus-item]")];
  const i = items.indexOf(control);
  return i < 0 ? [] : [...items.slice(i + 1), ...items.slice(0, i).reverse()];
}

/** With nothing near left (the last chip removed, Clear all): the list's Filter button, else its search field */
const LIST_FOCUS = ['[data-list-focus="filters"]', '[data-list-focus="search"]'];

const shown = (el: Element): el is HTMLElement =>
  el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;

/**
 * Around a list's filters and its results, so a search, sort or filter marks
 * the results busy the moment it changes, not when the server first answers
 * (SLN-753). The results go in `ListPendingSwap`.
 */
export function ListPendingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [waiting, setWaiting] = useState(false);
  // The control that started the wait. Hiding the results drops focus from a
  // control inside them (the eBooks table's sort headers); it comes back to it.
  // A control the results removed (a filter chip) hands focus on instead
  const from = useRef<Element | null>(null);
  const successors = useRef<Element[]>([]);
  const record = useCallback(() => {
    from.current = document.activeElement;
    successors.current = focusSuccessors(from.current);
  }, []);
  const begin = useCallback(() => {
    record();
    setWaiting(true);
  }, [record]);
  const navigate = useCallback((go: () => void) => {
    record();
    startTransition(() => {
      setWaiting(false);
      go();
    });
  }, [record]);
  const busy = waiting || isPending;
  useEffect(() => {
    if (busy) return;
    const control = from.current;
    const next = successors.current;
    from.current = null;
    successors.current = [];
    if (!(control instanceof HTMLElement)) return;
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    const target = control.isConnected
      ? control
      : (next.find(shown) ??
        LIST_FOCUS.map((s) => [...document.querySelectorAll(s)].find(shown)).find(Boolean));
    target?.focus({ preventScroll: true });
  }, [busy]);
  const value = useMemo(
    () => ({ busy, begin, navigate }),
    [busy, begin, navigate],
  );
  return (
    <ListBusyContext.Provider value={value}>
      {children}
    </ListBusyContext.Provider>
  );
}

/** The list's busy state, or null outside a `ListPendingProvider` */
export function useListBusy() {
  return useContext(ListBusyContext);
}

/** Runs a list's navigation, busy inside a `ListPendingProvider` and plain outside one */
export function useListNavigate() {
  const list = useContext(ListBusyContext);
  return useCallback(
    (go: () => void) => (list ? list.navigate(go) : go()),
    [list],
  );
}

/**
 * The results, swapped for the list's wait while busy. They stay mounted
 * underneath, so they keep their state when the same results come back.
 */
export function ListPendingSwap({ children }: { children: React.ReactNode }) {
  const busy = useContext(ListBusyContext)?.busy ?? false;
  return (
    <>
      {busy && <ListPending />}
      <div className={busy ? "hidden" : "contents"}>{children}</div>
    </>
  );
}
