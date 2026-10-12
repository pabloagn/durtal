import { describe, expect, it, vi } from "vitest";
import { InspectorOutputProtocol, inspectorReadyFrame, inspectorPdfPhaseFrame, inspectorReportFrame } from "@/lib/ebooks/upload/inspector-protocol";
import { OwnedInspectorRuntime, type CommandResult, type RuntimeCommands } from "@/lib/ebooks/upload/container-runtime";
import { InspectorAttemptBudget } from "@/lib/ebooks/upload/inspector-resources";
import { MiB } from "@/lib/ebooks/upload/limits";
import type { InspectorIdentity, InspectorRuntimeConfig } from "@/lib/ebooks/upload/runtime-contract";

const cgroup = { memoryMax: String(768 * MiB), memorySwapMax: "0", pidsMax: "16", cpuMax: "100000 100000" };
const bytes = (frame: string) => new TextEncoder().encode(frame);

describe("bounded inspector phase/result protocol", () => {
  it("handles split UTF-8 and returns a report only after limits and completed PDF phase", () => {
    const phases: string[] = []; const protocol = new InspectorOutputProtocol((phase) => phases.push(phase));
    const wire = bytes(inspectorReadyFrame(cgroup) + inspectorPdfPhaseFrame("start") + inspectorPdfPhaseFrame("end") + inspectorReportFrame({ title: "L’étranger" }));
    for (const byte of wire) protocol.write(new Uint8Array([byte]));
    expect(protocol.finish()).toBe('{"title":"L’étranger"}'); expect(phases).toEqual(["start", "end"]);
  });
  it("rejects parsing/report frames before verified actual process-tree limits", () => {
    for (const frame of [inspectorPdfPhaseFrame("start"), inspectorReportFrame({ title: "before limits" })]) {
      const protocol = new InspectorOutputProtocol(() => {}); expect(() => protocol.write(bytes(frame))).toThrow("limits");
    }
    expect(() => inspectorReadyFrame({ ...cgroup, memoryMax: "max" })).toThrow("Unbounded");
  });
  it("rejects active/repeated PDF phases, missing result, trailing output and oversized controls", () => {
    const protocol = new InspectorOutputProtocol(() => {}); protocol.write(bytes(inspectorReadyFrame(cgroup)));
    protocol.write(bytes(inspectorPdfPhaseFrame("start"))); expect(() => protocol.finish()).toThrow("incomplete");
    expect(() => protocol.write(bytes(inspectorPdfPhaseFrame("start")))).toThrow("order");
    const complete = new InspectorOutputProtocol(() => {}); complete.write(bytes(inspectorReadyFrame(cgroup) + inspectorReportFrame({ ok: true })));
    expect(() => complete.write(bytes(inspectorReportFrame({ second: true })))).toThrow("after result");
    const oversized = new InspectorOutputProtocol(() => {}); expect(() => oversized.write(bytes(" ".repeat(4097)))).toThrow("control frame");
    const malformed = new InspectorOutputProtocol(() => {}); expect(() => malformed.write(new Uint8Array([0xff]))).toThrow();
  });
  it("caps the complete wire output and fails an unterminated report", () => {
    expect(() => inspectorReportFrame({ huge: "x".repeat(8 * MiB) })).toThrow("bound");
    const protocol = new InspectorOutputProtocol(() => {}); protocol.write(bytes(inspectorReadyFrame(cgroup)));
    protocol.write(bytes('{"protocol":1,"kind":"report","payload":{"ok":true}}'));
    expect(() => protocol.finish()).toThrow("incomplete");
  });
  it("emits PDF phase end before returning extraction, and latches failures/retries", async () => {
    const phases: string[] = []; const budget = new InspectorAttemptBudget((phase) => phases.push(phase));
    expect(await budget.pdfText(async () => "text", new AbortController().signal)).toBe("text");
    expect(phases).toEqual(["start", "end"]);
    await expect(budget.pdfText(async () => "again", new AbortController().signal)).rejects.toThrow("already started");
    expect(() => budget.assertHealthy()).toThrow("already started");
  });
  it("enforces the PDF wall deadline in the host even if the worker stops responding", async () => {
    vi.useFakeTimers();
    try {
      const config: InspectorRuntimeConfig = { dockerExecutable: "/usr/bin/docker", dockerSocket: "/private/docker.sock", dockerConfigDirectory: "/private/config",
        image: `durtal/inspector@sha256:${"a".repeat(64)}`, spoolRoot: "/private/spool", uid: 1001, gid: 1001 };
      const identity: InspectorIdentity = { volumeId: "11111111-1111-4111-8111-111111111111", bindingSha256: "b".repeat(64),
        fence: { operationId: "22222222-2222-4222-8222-222222222222", ownerToken: "33333333-3333-4333-8333-333333333333", ownerFence: 7, generation: 2 } };
      const commands: RuntimeCommands = { run: vi.fn(async (args, options) => {
        if (args[0] === "info") return { stdout: JSON.stringify({ OSType: "linux", CgroupVersion: "2", MemoryLimit: true,
          SwapLimit: true, CpuCfsQuota: true, PidsLimit: true, Warnings: [], SecurityOptions: ["name=seccomp,profile=builtin"] }), stderr: "", exitCode: 0 };
        if (args[0] === "image") return { stdout: "[]", stderr: "", exitCode: 0 };
        options?.onStdout?.(bytes(inspectorReadyFrame(cgroup) + inspectorPdfPhaseFrame("start")));
        return new Promise<CommandResult>((_, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true }));
      }) };
      const runtime = new OwnedInspectorRuntime(config, commands);
      await runtime.preflight();
      vi.spyOn(runtime, "inspect").mockResolvedValue({ id: "c".repeat(64), identity, status: "created", exitCode: 0, oomKilled: false });
      const execute = runtime.execute(identity, new AbortController().signal);
      const rejection = expect(execute).rejects.toThrow("PDF text wall deadline");
      await vi.advanceTimersByTimeAsync(60_000); await rejection;
      expect(commands.run).toHaveBeenCalledTimes(3); // info + image + attach; abort is not exit/remove proof
    } finally { vi.useRealTimers(); }
  });
});
