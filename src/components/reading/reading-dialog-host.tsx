"use client";
import { Component, type ReactNode } from "react";
import { ReadingDialogSwitch } from "./reading-dialog-switch";
import { BookPicker } from "./book-picker";
import type { ReadingDialogProps } from "./reading-dialog-types";
import type { PickerPurpose } from "@/lib/reading/book-picker";

export interface ReadingDialogHostProps {
  dialog: ReadingDialogProps | null;
  picker: PickerPurpose | null;
  onClose(): void;
  onFailure(error: unknown): void;
}
class RendererBoundary extends Component<{ onFailure(error: unknown): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFailure(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function ReadingDialogHost(props: ReadingDialogHostProps) {
  return <RendererBoundary onFailure={props.onFailure}>
    {props.dialog && <ReadingDialogSwitch {...props.dialog} />}
    {props.picker && <BookPicker purpose={props.picker} onClose={props.onClose} />}
  </RendererBoundary>;
}
