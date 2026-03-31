"use client";

import {
  useRef,
  useCallback,
  useReducer,
  useEffect,
  type PointerEvent,
  type WheelEvent,
  type KeyboardEvent,
} from "react";

export interface TimelineTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 15;
const PAN_STEP = 80;
const ZOOM_FACTOR = 1.15;

type Action =
  | { type: "SET"; transform: TimelineTransform }
  | { type: "RESET" };

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function reducer(state: TimelineTransform, action: Action): TimelineTransform {
  switch (action.type) {
    case "SET":
      return action.transform;
    case "RESET":
      return { offsetX: 0, offsetY: 0, scale: 1 };
    default:
      return state;
  }
}

export interface TimelineTransformHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onWheel: (e: WheelEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export interface UseTimelineTransformReturn {
  transform: TimelineTransform;
  containerRef: React.RefObject<HTMLDivElement | null>;
  handlers: TimelineTransformHandlers;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  panTo: (offsetX: number) => void;
  setTransform: (t: TimelineTransform) => void;
}

export function useTimelineTransform(
  initialTransform?: Partial<TimelineTransform>,
): UseTimelineTransformReturn {
  const [transform, dispatch] = useReducer(reducer, {
    offsetX: initialTransform?.offsetX ?? 0,
    offsetY: initialTransform?.offsetY ?? 0,
    scale: initialTransform?.scale ?? 1,
  });

  // Refs for drag state — kept outside React state to avoid re-renders during drag
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragStartOffsetX = useRef(0);
  const dragStartOffsetY = useRef(0);
  const rafId = useRef<number | null>(null);
  // Use a ref to keep a live copy of the latest transform for raf callbacks
  const transformRef = useRef<TimelineTransform>(transform);
  transformRef.current = transform;
  const pendingTransform = useRef<TimelineTransform | null>(null);

  const commitPending = useCallback(() => {
    if (pendingTransform.current) {
      dispatch({ type: "SET", transform: pendingTransform.current });
      pendingTransform.current = null;
    }
    rafId.current = null;
  }, []);

  const scheduleUpdate = useCallback(
    (next: TimelineTransform) => {
      pendingTransform.current = next;
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(commitPending);
      }
    },
    [commitPending],
  );

  // Clean up any pending raf on unmount
  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  // ── Pointer events ────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    // Only main button (left click / single touch)
    if (e.button !== 0 && e.pointerType === "mouse") return;
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragStartOffsetX.current = transformRef.current.offsetX;
    dragStartOffsetY.current = transformRef.current.offsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!isDragging.current) return;
      const dx = e.clientX - dragStartX.current;
      const dy = e.clientY - dragStartY.current;
      const next: TimelineTransform = {
        ...transformRef.current,
        offsetX: dragStartOffsetX.current + dx,
        offsetY: dragStartOffsetY.current + dy,
      };
      scheduleUpdate(next);
    },
    [scheduleUpdate],
  );

  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    isDragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  // ── Wheel event ───────────────────────────────────────────────────────────

  const onWheel = useCallback(
    (e: WheelEvent<HTMLElement>) => {
      e.preventDefault();

      const current = transformRef.current;

      // Shift+wheel or horizontal scroll → pan horizontally
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        const next: TimelineTransform = {
          ...current,
          offsetX: current.offsetX - delta,
        };
        scheduleUpdate(next);
        return;
      }

      // Vertical scroll → zoom centered on cursor
      const rect = containerRef.current?.getBoundingClientRect();
      const cursorX = rect ? e.clientX - rect.left : 0;

      const zoomDelta = -e.deltaY * 0.001;
      const zoomMultiplier = Math.exp(zoomDelta * 0.8);
      const newScale = clampScale(current.scale * zoomMultiplier);

      // Zoom-toward-cursor: keep the world point under the cursor stationary
      // worldX = (cursorX - offsetX) / scale
      // After zoom: newOffsetX = cursorX - worldX * newScale
      const worldX = (cursorX - current.offsetX) / current.scale;
      const newOffsetX = cursorX - worldX * newScale;

      const next: TimelineTransform = {
        ...current,
        scale: newScale,
        offsetX: newOffsetX,
      };
      scheduleUpdate(next);
    },
    [scheduleUpdate],
  );

  // ── Keyboard events ───────────────────────────────────────────────────────

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const current = transformRef.current;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          scheduleUpdate({ ...current, offsetX: current.offsetX + PAN_STEP });
          break;
        case "ArrowRight":
          e.preventDefault();
          scheduleUpdate({ ...current, offsetX: current.offsetX - PAN_STEP });
          break;
        case "+":
        case "=": {
          e.preventDefault();
          const newScale = clampScale(current.scale * ZOOM_FACTOR);
          // Zoom toward center of container
          const containerWidth = containerRef.current?.clientWidth ?? 0;
          const center = containerWidth / 2;
          const worldX = (center - current.offsetX) / current.scale;
          scheduleUpdate({
            ...current,
            scale: newScale,
            offsetX: center - worldX * newScale,
          });
          break;
        }
        case "-": {
          e.preventDefault();
          const newScale = clampScale(current.scale / ZOOM_FACTOR);
          const containerWidth = containerRef.current?.clientWidth ?? 0;
          const center = containerWidth / 2;
          const worldX = (center - current.offsetX) / current.scale;
          scheduleUpdate({
            ...current,
            scale: newScale,
            offsetX: center - worldX * newScale,
          });
          break;
        }
        case "0":
          e.preventDefault();
          dispatch({ type: "RESET" });
          break;
        default:
          break;
      }
    },
    [scheduleUpdate],
  );

  // ── Imperative helpers ────────────────────────────────────────────────────

  const zoomIn = useCallback(() => {
    const current = transformRef.current;
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    const center = containerWidth / 2;
    const newScale = clampScale(current.scale * ZOOM_FACTOR);
    const worldX = (center - current.offsetX) / current.scale;
    dispatch({
      type: "SET",
      transform: { ...current, scale: newScale, offsetX: center - worldX * newScale },
    });
  }, []);

  const zoomOut = useCallback(() => {
    const current = transformRef.current;
    const containerWidth = containerRef.current?.clientWidth ?? 0;
    const center = containerWidth / 2;
    const newScale = clampScale(current.scale / ZOOM_FACTOR);
    const worldX = (center - current.offsetX) / current.scale;
    dispatch({
      type: "SET",
      transform: { ...current, scale: newScale, offsetX: center - worldX * newScale },
    });
  }, []);

  const resetView = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const panTo = useCallback((offsetX: number) => {
    dispatch({
      type: "SET",
      transform: { ...transformRef.current, offsetX },
    });
  }, []);

  const setTransform = useCallback((t: TimelineTransform) => {
    dispatch({ type: "SET", transform: t });
  }, []);

  return {
    transform,
    containerRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel, onKeyDown },
    zoomIn,
    zoomOut,
    resetView,
    panTo,
    setTransform,
  };
}
