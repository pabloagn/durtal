"use client";
import { useEffect, useRef, type RefObject } from "react";
import { CLEAR_LIST_SEARCH } from "@/lib/ui/list-search";

/** A clear link changes the draft without scheduling a competing URL update. */
export function useListSearchClear(
  input: RefObject<HTMLInputElement | null>,
  clear: (navigate: boolean) => void,
) {
  const latest = useRef(clear);
  latest.current = clear;
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const handle = (event: Event) => latest.current((event as CustomEvent<{ navigate: boolean }>).detail.navigate);
    field.addEventListener(CLEAR_LIST_SEARCH, handle);
    return () => field.removeEventListener(CLEAR_LIST_SEARCH, handle);
  });
}
