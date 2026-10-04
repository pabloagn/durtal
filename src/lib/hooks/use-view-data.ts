"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What a view (map, timeline) has loaded so far. `query` is the server prop
 * the load was for: a refresh or a navigation sends a new object, so data
 * loaded for an earlier object is never shown.
 */
export type ViewDataState<Q, T> =
  | { query: Q; status: "ready"; data: T }
  | { query: Q; status: "error" }
  | null;

export type ViewData<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; data: T };

/** True when the view is shown and holds nothing for this query yet. */
export function needsViewLoad<Q, T>(
  enabled: boolean,
  query: Q,
  state: ViewDataState<Q, T>,
): boolean {
  return enabled && state?.query !== query;
}

/** What the view shows for this query. */
export function viewDataStatus<Q, T>(
  enabled: boolean,
  query: Q,
  state: ViewDataState<Q, T>,
  retry: () => void,
): ViewData<T> {
  if (!enabled) return { status: "idle" };
  if (state?.query !== query) return { status: "loading" };
  if (state.status === "error") return { status: "error", retry };
  return { status: "ready", data: state.data };
}

/**
 * Load data for a view only while that view is shown. `query` must be the
 * object the server sent (search and filters): switching views keeps the
 * loaded data, while a router.refresh or a new filter loads it again.
 */
export function useViewData<Q, T>(
  enabled: boolean,
  query: Q,
  load: (query: Q) => Promise<T>,
): ViewData<T> {
  const [state, setState] = useState<ViewDataState<Q, T>>(null);
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!needsViewLoad(enabled, query, stateRef.current)) return;
    let current = true;
    loadRef.current(query).then(
      (data) => {
        if (current) setState({ query, status: "ready", data });
      },
      (err) => {
        console.error(err);
        if (current) setState({ query, status: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [enabled, query, attempt]);

  const retry = useCallback(() => {
    setState(null);
    setAttempt((n) => n + 1);
  }, []);

  return viewDataStatus(enabled, query, state, retry);
}
