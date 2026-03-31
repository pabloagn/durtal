"use client";

import { useCallback, type CSSProperties, type ReactNode } from "react";

interface ProtectedImageWrapperProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Wraps any image element to prevent right-click saving, dragging,
 * and other download mechanisms. Adds an invisible overlay that
 * intercepts all pointer interactions directed at the image.
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
      {/* Invisible overlay to prevent direct image interaction */}
      <div
        className="absolute inset-0 z-[1]"
        style={{ background: "transparent" }}
        aria-hidden="true"
      />
    </div>
  );
}
