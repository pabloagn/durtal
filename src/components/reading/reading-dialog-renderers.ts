import type { ComponentType } from "react";
import type { ReadingDialog, ReadingDialogProps } from "./reading-dialog-types";

/** No import runs until the selected dialog invokes its loader. */
export const readingDialogRenderers: Record<ReadingDialog | "timer-block", () => Promise<ComponentType<ReadingDialogProps>>> = {
  start: () => import("./dialogs/start-reading-dialog").then((m) => m.StartReadingDialog),
  progress: () => import("./dialogs/log-progress-dialog").then((m) => m.LogProgressDialog),
  finish: () => import("./dialogs/finish-reading-dialog").then((m) => m.FinishReadingDialog),
  abandon: () => import("./dialogs/abandon-reading-dialog").then((m) => m.AbandonReadingDialog),
  past: () => import("./dialogs/past-read-dialog").then((m) => m.PastReadDialog),
  edit: () => import("./dialogs/edit-reading-dialog").then((m) => m.EditReadingDialog),
  delete: () => import("./dialogs/delete-reading-dialog").then((m) => m.DeleteReadingDialog),
  session: () => import("./dialogs/session-dialog").then((m) => m.SessionDialog),
  note: () => import("./dialogs/note-dialog").then((m) => m.NoteDialog),
  "timer-block": () => import("./timer-chip").then((m) => m.TimerBlockDialog),
};
