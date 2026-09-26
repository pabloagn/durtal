"use client";

import { useCallback, type CSSProperties, type ReactNode } from "react";

interface ProtectedImageWrapperProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Wraps images to prevent right-click saving and dragging. The overlay lets clicks reach image/lightbox controls;
 * context-menu and drag events are still blocked on the wrapper.
 */
export function ProtectedImageWrapper({
  children,
  className = "",
  style,
}: ProtectedImageWrapperProps) {
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      className={`relative ${className}`}
      style={style}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
    >
      {children}
      {/* Let image controls receive clicks; protection handlers live on the wrapper. */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{ background: "transparent" }}
        aria-hidden="true"
      />
    </div>
  );
}
