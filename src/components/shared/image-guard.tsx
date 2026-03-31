"use client";

import { useEffect } from "react";

/**
 * Global image protection: blocks right-click context menu on all images
 * and prevents drag-to-save. Mount once in the layout.
 */
export function ImageGuard() {
  useEffect(() => {
    function blockContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "IMG" ||
        target.closest(".protected-image") ||
        target.closest("[data-protected]")
      ) {
        e.preventDefault();
      }
    }

    function blockDrag(e: DragEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "IMG") {
        e.preventDefault();
      }
    }

    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("dragstart", blockDrag);
    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("dragstart", blockDrag);
    };
  }, []);

  return null;
}
