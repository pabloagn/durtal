"use client";

import dynamic from "next/dynamic";
import { useOptionalTimer } from "./timer-provider";
import type { ReadingDialogProps } from "./reading-dialog-types";

const StartReadingDialog = dynamic(() => import("./dialogs/start-reading-dialog").then((m) => m.StartReadingDialog));
const LogProgressDialog = dynamic(() => import("./dialogs/log-progress-dialog").then((m) => m.LogProgressDialog));
const FinishReadingDialog = dynamic(() => import("./dialogs/finish-reading-dialog").then((m) => m.FinishReadingDialog));
const AbandonReadingDialog = dynamic(() => import("./dialogs/abandon-reading-dialog").then((m) => m.AbandonReadingDialog));
const PastReadDialog = dynamic(() => import("./dialogs/past-read-dialog").then((m) => m.PastReadDialog));
const EditReadingDialog = dynamic(() => import("./dialogs/edit-reading-dialog").then((m) => m.EditReadingDialog));
const DeleteReadingDialog = dynamic(() => import("./dialogs/delete-reading-dialog").then((m) => m.DeleteReadingDialog));
const SessionDialog = dynamic(() => import("./dialogs/session-dialog").then((m) => m.SessionDialog));
const NoteDialog = dynamic(() => import("./dialogs/note-dialog").then((m) => m.NoteDialog));

const TimerBlockDialog = dynamic(() => import("./timer-chip").then((m) => m.TimerBlockDialog));

/** The dialog a request asks for; a dialog on a reading needs that reading */
export function ReadingDialogSwitch(props: ReadingDialogProps) {
  const { request, row } = props;
  // A reading being timed is not closed or deleted: its dialogs offer Stop and Discard (SLN-451)
  const timer = useOptionalTimer();
  if (row && timer?.timer?.readingId === row.reading.id && (request.kind === "finish" || request.kind === "abandon" || request.kind === "delete"))
    return <TimerBlockDialog {...props} />;
  if (request.kind === "start") return <StartReadingDialog {...props} />;
  if (request.kind === "past") return <PastReadDialog {...props} />;
  if (request.kind === "note") return <NoteDialog {...props} />;
  if (!row) return null;
  if (request.kind === "progress") return <LogProgressDialog {...props} />;
  if (request.kind === "finish") return <FinishReadingDialog {...props} />;
  if (request.kind === "abandon") return <AbandonReadingDialog {...props} />;
  if (request.kind === "edit") return <EditReadingDialog {...props} />;
  if (request.kind === "session") return <SessionDialog {...props} />;
  return <DeleteReadingDialog {...props} />;
}
