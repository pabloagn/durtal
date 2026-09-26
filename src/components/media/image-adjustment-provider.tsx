"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  imageAdjustmentStyles,
  type StoredImageAdjustments,
} from "@/lib/utils/image-adjustments";

const AdjustmentContext = createContext<
  (record: StoredImageAdjustments) => void
>(() => {});

/** Match canonical asset URLs across cards, thumbnails and lightboxes, including portals. */
export function ImageAdjustmentProvider({
  initial,
  children,
}: {
  initial: StoredImageAdjustments[];
  children: React.ReactNode;
}) {
  const [edits, setEdits] = useState<Record<string, StoredImageAdjustments>>(
    {},
  );
  const update = useCallback((record: StoredImageAdjustments) => {
    setEdits((current) => ({ ...current, [record.assetKey]: record }));
  }, []);
  const css = useMemo(() => {
    const records = new Map(initial.map((record) => [record.assetKey, record]));
    for (const record of Object.values(edits))
      records.set(record.assetKey, record);
    return imageAdjustmentStyles([...records.values()]);
  }, [initial, edits]);
  return (
    <AdjustmentContext.Provider value={update}>
      <style data-image-adjustments>{css}</style>
      {children}
    </AdjustmentContext.Provider>
  );
}

export function useImageAdjustmentUpdate() {
  return useContext(AdjustmentContext);
}
