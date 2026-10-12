import { requireInspectorCgroup, type InspectorCgroupValues } from "./inspector-resources";
import { INSPECTOR_PROTOCOL } from "./runtime-contract";
import { UPLOAD_LIMITS } from "./limits";

const CONTROL_BYTES = 4096;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid inspector protocol object");
  return value as JsonObject;
};

/** Newline-delimited worker frames; control precedes parsing, results remain bounded. */
export class InspectorOutputProtocol {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private bytes = 0;
  private ready = false;
  private pdf: "absent" | "active" | "finished" = "absent";
  private report: JsonObject | null = null;
  private failed: unknown;

  constructor(private readonly onPdfPhase: (phase: "start" | "end") => void) {}

  write(chunk: Uint8Array): void {
    if (this.failed) throw this.failed;
    try {
      this.bytes += chunk.byteLength;
      if (this.bytes > UPLOAD_LIMITS.reportBytes) throw new Error("Inspector protocol output exceeds its bound");
      this.buffer += this.decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        this.frame(line);
      }
      if (Buffer.byteLength(this.buffer, "utf8") > CONTROL_BYTES
        && (!this.ready || !this.buffer.startsWith('{"protocol":1,"kind":"report","payload":')))
        throw new Error("Inspector unterminated control frame exceeds its bound");
    } catch (error) { this.failed = error; throw error; }
  }

  finish(): string {
    if (this.failed) throw this.failed;
    this.buffer += this.decoder.decode();
    if (this.buffer || !this.ready || !this.report || this.pdf === "active") throw new Error("Inspector protocol is incomplete");
    return JSON.stringify(this.report);
  }

  private frame(line: string): void {
    if (!line || this.report) throw new Error("Unexpected inspector output after result");
    const frame = object(JSON.parse(line));
    if (frame.protocol !== INSPECTOR_PROTOCOL) throw new Error("Inspector protocol version differs");
    if (frame.kind !== "report" && Buffer.byteLength(line, "utf8") > CONTROL_BYTES) throw new Error("Inspector control frame exceeds its bound");
    if (!this.ready) {
      if (frame.kind !== "ready" || frame.v8HeapBytes !== UPLOAD_LIMITS.v8HeapBytes) throw new Error("Inspector limits must precede parsing");
      const cgroup = object(frame.cgroup);
      for (const key of ["memoryMax", "memorySwapMax", "pidsMax", "cpuMax"])
        if (typeof cgroup[key] !== "string" || (cgroup[key] as string).length > 256) throw new Error("Malformed inspector cgroup proof");
      requireInspectorCgroup(cgroup as unknown as InspectorCgroupValues);
      this.ready = true;
      return;
    }
    if (frame.kind === "phase" && frame.phase === "pdf_text") {
      if (frame.state === "start" && this.pdf === "absent") { this.pdf = "active"; this.onPdfPhase("start"); return; }
      if (frame.state === "end" && this.pdf === "active") { this.pdf = "finished"; this.onPdfPhase("end"); return; }
      throw new Error("Inspector PDF phase order differs");
    }
    if (frame.kind !== "report" || this.pdf === "active") throw new Error("Unexpected inspector protocol frame");
    this.report = object(frame.payload);
  }
}

/** Worker bootstrap uses these before invoking the actual bounded 494 adapter. */
export function inspectorReadyFrame(cgroup: InspectorCgroupValues): string {
  requireInspectorCgroup(cgroup);
  return `${JSON.stringify({ protocol: INSPECTOR_PROTOCOL, kind: "ready", v8HeapBytes: UPLOAD_LIMITS.v8HeapBytes, cgroup })}\n`;
}

export function inspectorPdfPhaseFrame(state: "start" | "end"): string {
  if (state !== "start" && state !== "end") throw new Error("Invalid inspector PDF phase");
  return `${JSON.stringify({ protocol: INSPECTOR_PROTOCOL, kind: "phase", phase: "pdf_text", state })}\n`;
}

export function inspectorReportFrame(payload: Record<string, unknown>): string {
  const frame = `${JSON.stringify({ protocol: INSPECTOR_PROTOCOL, kind: "report", payload })}\n`;
  if (Buffer.byteLength(frame, "utf8") > UPLOAD_LIMITS.reportBytes) throw new Error("Inspector report exceeds its bound");
  return frame;
}
