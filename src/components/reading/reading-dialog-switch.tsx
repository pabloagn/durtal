"use client";

import { DeferredFeature } from "@/components/ui/feature-renderer";
import { useOptionalTimer } from "./timer-provider";
import type { ReadingDialogProps } from "./reading-dialog-types";
import { readingDialogRenderers } from "./reading-dialog-renderers";

/** The dialog a request asks for; a dialog on a reading needs that reading */
export function ReadingDialogSwitch(props: ReadingDialogProps) {
  const { request, row } = props;
  // A reading being timed is not closed or deleted: its dialogs offer Stop and Discard (SLN-451)
  const timer = useOptionalTimer();
  const resource = row && timer?.timer?.readingId === row.reading.id && ["finish", "abandon", "delete"].includes(request.kind)
    ? "timer-block" : request.kind;
  if (!row && !["start", "past", "note"].includes(request.kind)) return null;
  return <DeferredFeature key={resource} load={readingDialogRenderers[resource]} rendererProps={props} close={props.onClose} />;
}
