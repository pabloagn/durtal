"use client";
import { openOfflineStore } from "./store";
import { createReaderTransport, type TransportOptions } from "./transport";
import type { AnnotationMutation } from "./mutations";
import { decodeAnnotationReceipt, validateSharedAnnotationBody } from "../sync/annotation-codec";

export interface AnnotationDomain {
  validate: (body: AnnotationMutation["body"]) => boolean;
  decode: TransportOptions["decodeAnnotations"];
}
const sharedAnnotationDomain: AnnotationDomain = {
  validate: validateSharedAnnotationBody,
  decode: decodeAnnotationReceipt,
};
let annotations: AnnotationDomain | null = null;
let runtime: Promise<ReturnType<typeof createReaderTransport>> | null = null;
/** SLN-500 registers its trusted domain before mounting its reader coordinator.
 * Both domains then share this one origin store and one network replayer.
 */
export function configureAnnotationDomain(domain: AnnotationDomain): void {
  if (annotations && annotations !== domain) throw new Error("Annotation domain already configured");
  annotations = domain;
}
export function getReaderRuntime() {
  if (typeof window === "undefined") return Promise.reject(new Error("Reader persistence is browser-only"));
  if (!runtime) runtime = openOfflineStore({ validateAnnotations: body => (annotations ?? sharedAnnotationDomain).validate(body) })
    .then(store => createReaderTransport({ store,
      positionAcknowledged: body => !!body && typeof body === "object" &&
        "saved" in body && typeof body.saved === "boolean" && "position" in body &&
        !!body.position && typeof body.position === "object",
      decodeAnnotations: (body, plan) => {
        return (annotations ?? sharedAnnotationDomain).decode(body, plan);
      },
      onError: error => window.dispatchEvent(new CustomEvent("durtal-reader-persistence", { detail: error })),
    })).catch(error => { runtime = null; throw error; });
  return runtime;
}
