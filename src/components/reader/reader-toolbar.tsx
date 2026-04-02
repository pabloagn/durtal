"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  List,
  Settings,
  Bookmark,
  Maximize,
  Minimize,
} from "lucide-react";

interface ReaderToolbarProps {
  title: string;
  author: string;
  chapter: string;
  onToggleToc: () => void;
  onToggleSettings: () => void;
  onToggleBookmark?: () => void;
}

export function ReaderToolbar({
  title,
  author,
  chapter,
  onToggleToc,
  onToggleSettings,
  onToggleBookmark,
}: ReaderToolbarProps) {
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-hide after 3 seconds of inactivity
  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => setVisible(false), 3000);
  }, []);

  useEffect(() => {
    const handleMouseMove = () => resetHideTimer();
    document.addEventListener("mousemove", handleMouseMove);
    resetHideTimer();
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [resetHideTimer]);

  // Track fullscreen state
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  return (
    <div
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        visible
          ? "translate-y-0 opacity-100"
          : "-translate-y-full opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex h-12 items-center justify-between bg-bg-primary/90 px-4 backdrop-blur-sm border-b border-glass-border">
        {/* Left: back + title */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/reader"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="truncate font-serif text-sm text-fg-primary">
                {title}
              </span>
              {chapter && (
                <>
                  <span className="text-fg-muted">&mdash;</span>
                  <span className="truncate text-xs text-fg-secondary">
                    {chapter}
                  </span>
                </>
              )}
            </div>
            <p className="truncate text-micro text-fg-muted">{author}</p>
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-1">
          {onToggleBookmark && (
            <button
              onClick={onToggleBookmark}
              className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
              title="Bookmark (B)"
            >
              <Bookmark className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <button
            onClick={onToggleToc}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            title="Table of Contents (T)"
          >
            <List className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            onClick={onToggleSettings}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            title="Settings (S)"
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
            title="Fullscreen (F)"
          >
            {fullscreen ? (
              <Minimize className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <Maximize className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
