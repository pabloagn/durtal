"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  imageAdjustmentRule,
  type StoredImageAdjustments,
} from "@/lib/utils/image-adjustment-css";

const AdjustmentContext = createContext<
  (record: StoredImageAdjustments) => void
>(() => {});

/**
 * Saved adjustments come from the cached stylesheet in the root layout. This
 * provider adds only the edits saved since the page loaded, so they show at once.
 */
export function ImageAdjustmentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [edits, setEdits] = useState<Record<string, StoredImageAdjustments>>(
    {},
  );
  const update = useCallback((record: StoredImageAdjustments) => {
    setEdits((current) => ({ ...current, [record.assetKey]: record }));
  }, []);
  const css = useMemo(
    () => Object.values(edits).map(imageAdjustmentRule).join("\n"),
    [edits],
  );
  return (
    <AdjustmentContext.Provider value={update}>
      {css && <style data-image-adjustments>{css}</style>}
      {children}
    </AdjustmentContext.Provider>
  );
}

export function useImageAdjustmentUpdate() {
  return useContext(AdjustmentContext);
}
