"use client";

import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";

/**
 * An image that fades in (150 ms) over its frame's tone when it has loaded,
 * instead of popping in on black. An image that is already loaded when the
 * page becomes interactive (server-rendered, cached) stays as it is: no fade,
 * no flash. No fade under `prefers-reduced-motion`.
 *
 * The frame (the parent) gives the tone: `coverToneStyle` (media-style.ts)
 * for a poster's main color, else `bg-bg-tertiary`.
 *
 * An image that fails shows `fallback` in its place (a cover's letter, a
 * person's initials), or with none the bare frame: never the browser's
 * broken-image mark or its alt text, which stays for a screen reader. A failure that came before the page
 * became interactive, when React was not yet listening, is caught here too
 * and reported through `onError`, so a caller that retries still can.
 */
export function FadeImage({
  className = "",
  onLoad,
  onError,
  fallback,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { fallback?: ReactNode }) {
  const ref = useRef<HTMLImageElement>(null);
  // Before hydration the image shows as soon as the browser has it
  const [state, setState] = useState<"server" | "loading" | "loaded" | "failed">("server");

  useLayoutEffect(() => {
    const img = ref.current;
    // A new source after a failure: draw the image again in place of the fallback
    if (!img) return setState("loading");
    if (!img.complete) return setState("loading");
    if (img.naturalWidth) return setState("loaded");
    // Complete with no width: it failed before React listened, or it is an
    // SVG with no size of its own. Decoding tells them apart
    setState("loading");
    let live = true;
    img.decode().then(
      () => live && setState("loaded"),
      () => live && img.dispatchEvent(new Event("error")),
    );
    return () => {
      live = false;
    };
  }, [props.src]);

  // The alt stays for a screen reader: a fallback is decoration
  if (state === "failed" && fallback !== undefined)
    return (
      <>
        {fallback}
        {props.alt ? <span className="sr-only">{props.alt}</span> : null}
      </>
    );
  return (
    <img
      ref={ref}
      {...props}
      onLoad={(e) => {
        setState("loaded");
        onLoad?.(e);
      }}
      onError={(e) => {
        setState("failed");
        onError?.(e);
      }}
      className={`${className} ${state === "loading" || state === "failed" ? "opacity-0" : ""} fade-image`}
    />
  );
}
