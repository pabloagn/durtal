"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
  const begin = useCallback(() => setWaiting(true), []);
  const navigate = useCallback((go: () => void) => {
    startTransition(() => {
      setWaiting(false);
      go();
    });
  }, []);
  const value = useMemo(
    () => ({ busy: waiting || isPending, begin, navigate }),
    [waiting, isPending, begin, navigate],
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
