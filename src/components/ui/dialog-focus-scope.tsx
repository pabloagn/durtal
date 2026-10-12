"use client";
import { createContext, useContext } from "react";
import type { SurfaceLease } from "@/lib/ui/surface-state";

/** A lazy host owns its lease and focus return across renderer replacements. */
export const DialogFocusScope = createContext<SurfaceLease | null>(null);
export const useDialogFocusScope = () => useContext(DialogFocusScope);
