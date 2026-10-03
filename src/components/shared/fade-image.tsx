"use client";

import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from "react";

/**
 * An image that fades in (150 ms) over its frame's tone when it has loaded,
 * instead of popping in on black. An image that is already loaded when the
 * page becomes interactive (server-rendered, cached) stays as it is: no fade,
 * no flash. No fade under `prefers-reduced-motion`.
 *
 * The frame (the parent) gives the tone: `coverToneStyle` (media-style.ts)
 * for a poster's main color, else `bg-bg-tertiary`.
 */
export function FadeImage({
  className = "",
  onLoad,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const ref = useRef<HTMLImageElement>(null);
  // Before hydration the image shows as soon as the browser has it
  const [state, setState] = useState<"server" | "loading" | "loaded">("server");

  useLayoutEffect(() => {
    const img = ref.current;
    setState(img?.complete && img.naturalWidth ? "loaded" : "loading");
  }, [props.src]);

  return (
    <img
      ref={ref}
      {...props}
      onLoad={(e) => {
        setState("loaded");
        onLoad?.(e);
      }}
      className={`${className} ${state === "loading" ? "opacity-0" : ""} [transition:opacity_150ms_ease-out,transform_300ms_ease] motion-reduce:transition-none`}
    />
  );
}
