/** Opt-in QA metadata; disabled callers gate before allocating callbacks. */
const phases = new Set(["worker-construct", "worker-messageerror", "worker-abort", "worker-loaded-processing-start", "worker-decode-complete-scan-start", "worker-scan-complete", "worker-result", "worker-result-error", "worker-error", "worker-input-posted", "index-timer-scheduled", "index-timer-fired", "index-generator-start", "index-generator-complete", "index-publish-requested", "index-flow-error"]);
const limits: Record<string, number> = {
  phase: 80,
  errorName: 64,
  errorCode: 64,
  filename: 512,
  compressedBytes: 0,
  markupLength: 0,
  fragmentCount: 0,
  method: 0,
  workerAt: 0,
  length: 0,
  offsetCount: 0,
  line: 0,
  column: 0,
  hrefCount: 0,
  complete: 0,
};
export function observeIndexDiagnostic(
  phase: string,
  detail?: () => Record<string, unknown>,
) {
  const observe = (globalThis as unknown as {
    __durtalIndexDiagnostic?: (event: Record<string, unknown>) => void;
  }).__durtalIndexDiagnostic;
  if (typeof observe !== "function" || !phases.has(phase)) return;
  try {
    const event: Record<string, unknown> = { phase: phase.slice(0, 80) };
    for (const [key, value] of Object.entries(detail?.() ?? {})) {
      if (!Object.hasOwn(limits, key) || key === "phase") continue;
      const limit = limits[key];
      if (typeof value === "string" && limit > 0) {
        if (key === "errorName" && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) continue;
        if (key === "errorCode" && !/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) continue;
        if (key === "filename" && (!/^[A-Za-z0-9_./:@~%-]*$/.test(value) || value.length > 512)) continue;
        event[key] = value.slice(0, limit);
      }
      else if (typeof value === "number" && Number.isFinite(value))
        event[key] = Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, value));
      else if (typeof value === "boolean") event[key] = value;
    }
    observe(event);
  } catch {
    console.error("Index diagnostic observer failed", "INDEX_DIAGNOSTIC_OBSERVER_ERROR");
  }
}
export function indexDiagnosticEnabled() {
  return typeof (globalThis as unknown as {
    __durtalIndexDiagnostic?: unknown;
  }).__durtalIndexDiagnostic === "function";
}
