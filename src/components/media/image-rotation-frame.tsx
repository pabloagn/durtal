"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefCallback,
  type ReactEventHandler,
} from "react";
import { type AppliedCrop } from "@/lib/media/crop";
import {
  imageRotationGeometry,
  isImageRotation,
  normalizeImageRotation,
} from "@/lib/media/rotation";

export interface RotationImageBinding {
  src: string;
  ref: RefCallback<HTMLImageElement>;
  onLoad: ReactEventHandler<HTMLImageElement>;
  /** Compose with consumer error handling so its fallback remains visible. */
  onError: ReactEventHandler<HTMLImageElement>;
  /** Spread last on the image: the containing React layer owns rotation. */
  style: CSSProperties;
}

export interface ImageRotationFrameProps {
  rotation: number;
  src: string;
  /** Exact existing rendering, returned directly at zero degrees. */
  original: ReactNode;
  /** Error state includes cached failures; keep fallback UI free of crop/rotation transforms. */
  renderImage: (
    binding: RotationImageBinding,
    state: { failed: boolean },
  ) => ReactNode;
  pendingCrop?: AppliedCrop | null;
  cropAspect?: number | null;
  className?: string;
  /** A finite content slot; put borders, padding and placement transforms outside. */
  frameStyle?: Pick<
    CSSProperties,
    | "width"
    | "height"
    | "minWidth"
    | "minHeight"
    | "maxWidth"
    | "maxHeight"
    | "aspectRatio"
  >;
}

/** React owns every layer. Unadjusted images create no observer or extra DOM. */
export function ImageRotationFrame(props: ImageRotationFrameProps) {
  if (
    !isImageRotation(props.rotation) ||
    normalizeImageRotation(props.rotation) === 0
  ) {
    return props.original;
  }
  return <RotatedFrame key={props.src} {...props} />;
}

function RotatedFrame({
  src,
  rotation,
  renderImage,
  pendingCrop,
  cropAspect,
  className,
  frameStyle,
}: ImageRotationFrameProps) {
  const frame = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const readImage = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    setNatural((old) =>
      old.width === width && old.height === height ? old : { width, height },
    );
    // A complete, dimensionless image can be a cached failure. Do not wait
    // for an error event that already fired before this ref was attached.
    setFailed(width > 0 && height > 0 ? false : img.complete);
  }, []);
  const onLoad = useCallback<ReactEventHandler<HTMLImageElement>>(
    (event) => {
      readImage(event.currentTarget);
    },
    [readImage],
  );
  const onError = useCallback<ReactEventHandler<HTMLImageElement>>(() => {
    setNatural({ width: 0, height: 0 });
    setFailed(true);
  }, []);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const update = (width: number, height: number) => {
      setSize((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    };
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === element)
            update(entry.contentRect.width, entry.contentRect.height);
        }
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const measure = () => update(element.clientWidth, element.clientHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const geometry = imageRotationGeometry({
    sourceWidth: natural.width,
    sourceHeight: natural.height,
    frameWidth: size.width,
    frameHeight: size.height,
    rotation,
    pendingCrop,
    cropAspect,
  });
  return (
    <span
      ref={frame}
      className={className}
      data-image-rotation-frame
      style={{
        width: "100%",
        height: "100%",
        ...frameStyle,
        position: "relative",
        display: "block",
        overflow: "hidden",
        padding: 0,
        border: 0,
      }}
    >
      <span
        data-image-rotation-selection
        style={{
          position: "absolute",
          overflow: "hidden",
          visibility: failed || geometry ? "visible" : "hidden",
          ...(failed
            ? { left: 0, top: 0, width: "100%", height: "100%" }
            : geometry?.selection),
          // Error text/fallbacks occupy the finite content frame, unrotated.
          transform: failed
            ? undefined
            : `rotate(${normalizeImageRotation(rotation)}deg)`,
          transformOrigin: "center",
        }}
      >
        {renderImage(
          {
            src,
            ref: readImage,
            onLoad,
            onError,
            style: {
              position: "absolute",
              ...(failed
                ? { left: 0, top: 0, width: "100%", height: "100%" }
                : geometry?.image),
              maxWidth: "none",
              maxHeight: "none",
              objectFit: failed ? "contain" : "fill",
            },
          },
          { failed },
        )}
      </span>
    </span>
  );
}
