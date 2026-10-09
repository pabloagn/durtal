"use client";

// Installed as a temporary local QA route by prepare-rotation-proof.mjs.
// Imports the production core/preview adapter and BOTH real lightboxes.
// It does not claim to exercise the shared editor's controls or Save.
import { useEffect, useState } from "react";
import Image from "next/image";
import { Lightbox } from "@/components/media/lightbox";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import {
  ImageRotationFrame,
  type RotationImageBinding,
} from "@/components/media/image-rotation-frame";
import { ImageRotationPreview } from "@/components/media/image-rotation-preview";
import { NO_CROP, type AppliedCrop } from "@/lib/media/crop";

type State = {
  rotation: number;
  scenario:
    | "neutral"
    | "explicit"
    | "recrop"
    | "reset-crop"
    | "legacy"
    | "portrait";
  consumer: "plain" | "next" | "preview" | "media-lightbox" | "shared-lightbox";
  broken: boolean;
  transformed: boolean;
  version: number;
};
const defaults: State = {
  rotation: 0,
  scenario: "neutral",
  consumer: "preview",
  broken: false,
  transformed: false,
  version: 0,
};
const fixture = (name: string) => `/qa/image-rotation-fixtures/${name}.png`;
const applied = { x: 30, y: 70, zoom: 140 };
export default function RotationProofPage() {
  const [state, setState] = useState(defaults);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const change = (event: Event) => {
      const update = (event as CustomEvent<Partial<State> & { open?: boolean }>)
        .detail;
      setState((old) => ({ ...old, ...update }));
      if (update.open !== undefined) setOpen(update.open);
    };
    window.addEventListener("rotation-proof:change", change);
    return () => window.removeEventListener("rotation-proof:change", change);
  }, []);
  let display = fixture("landscape"),
    preview = display;
  let crop: AppliedCrop | null = NO_CROP,
    baseline: AppliedCrop | null = NO_CROP;
  if (["explicit", "recrop", "reset-crop"].includes(state.scenario)) {
    display = fixture("saved-crop");
    preview = fixture("landscape");
    baseline = applied;
    crop = state.scenario === "reset-crop" ? NO_CROP : applied;
    if (state.scenario === "recrop") baseline = { x: 10, y: 20, zoom: 120 };
  }
  if (state.scenario === "legacy") {
    display = preview = fixture("legacy");
    crop = baseline = { x: 25, y: 70, zoom: 135 };
  }
  if (state.scenario === "portrait") display = preview = fixture("portrait");
  if (state.broken) display = preview = fixture("missing");
  if (state.version) {
    display += `?v=${state.version}`;
    preview += `?v=${state.version}`;
  }
  const renderImage = (
    binding: RotationImageBinding,
    { failed }: { failed: boolean },
  ) => {
    if (failed)
      return (
        <button
          type="button"
          onClick={() => setState((old) => ({ ...old, broken: false }))}
        >
          Retry image
        </button>
      );
    const props = {
      ...binding,
      alt: "A1 B2 C3 D4 asymmetric UP raster",
      "data-adjustment-preview": true,
      style: { filter: "grayscale(100%)", ...binding.style },
    };
    return state.consumer === "next" ? (
      <Image {...props} width={1200} height={600} unoptimized />
    ) : (
      <img {...props} />
    );
  };
  const original = (
    <img
      src={state.consumer === "preview" ? preview : display}
      alt="A1 B2 C3 D4 asymmetric UP raster"
      data-adjustment-preview
      className="h-full w-full object-cover"
      style={{
        filter: "grayscale(100%)",
        ...(state.consumer === "preview" && crop
          ? {
              objectPosition: `${crop.x}% ${crop.y}%`,
              transform: `scale(${crop.zoom / 100})`,
              transformOrigin: `${crop.x}% ${crop.y}%`,
            }
          : {}),
      }}
    />
  );
  const nextOriginal = (
    <Image
      src={display}
      alt="A1 B2 C3 D4 asymmetric UP raster"
      width={1200}
      height={600}
      unoptimized
      data-adjustment-preview
      className="h-full w-full object-cover"
      style={{ filter: "grayscale(100%)" }}
    />
  );
  return (
    <main
      className="p-6"
      data-rotation-proof
      data-scenario={state.scenario}
      data-consumer={state.consumer}
    >
      <label>
        Angle{" "}
        <input
          aria-label="Proof angle"
          type="range"
          min={-180}
          max={180}
          step={1}
          value={state.rotation}
          onChange={(event) =>
            setState({ ...state, rotation: Number(event.target.value) })
          }
        />
      </label>
      <button onClick={() => setState({ ...state, rotation: 0 })}>
        Reset angle
      </button>
      <button onClick={() => setOpen(true)}>Open actual lightbox</button>
      <div
        data-proof-parent
        style={{
          width: 200,
          height: 300,
          margin: 40,
          overflow: "hidden",
          transform: state.transformed
            ? "translate(8px, 6px) scale(1.1)"
            : undefined,
        }}
      >
        {state.consumer === "preview" ? (
          <ImageRotationPreview
            rotation={state.rotation}
            sources={{ display, preview }}
            crop={crop}
            baselineCrop={baseline}
            cropAspect={2 / 3}
            original={original}
            renderImage={renderImage}
          />
        ) : (
          <ImageRotationFrame
            rotation={state.rotation}
            src={display}
            original={state.consumer === "next" ? nextOriginal : original}
            renderImage={renderImage}
          />
        )}
      </div>
      {open && state.consumer === "media-lightbox" && (
        <Lightbox
          initialIndex={0}
          onClose={() => setOpen(false)}
          images={[
            {
              src: display,
              alt: "Actual media lightbox marked raster",
              rotation: state.rotation,
              caption:
                "A deliberately long caption that wraps on narrow screens. The entire image must remain inside its finite content slot while this identifying text and navigation controls remain visible.",
            },
            {
              src: fixture("portrait"),
              alt: "Replacement portrait marked raster",
              rotation: state.rotation,
            },
          ]}
        />
      )}
      <ImageLightbox
        open={open && state.consumer === "shared-lightbox"}
        onClose={() => setOpen(false)}
        src={display}
        alt="Actual shared lightbox marked raster"
        rotation={state.rotation}
      />
    </main>
  );
}
