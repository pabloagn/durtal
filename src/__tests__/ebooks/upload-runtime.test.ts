import { describe, expect, it, vi } from "vitest";
import { inspectorFailureDetail, OwnedInspectorRuntime, verifyInspectorContainer, type RuntimeCommands } from "@/lib/ebooks/upload/container-runtime";
import { inspectorCreateArguments, inspectorLabels, inspectorName, INSPECTOR_COMMAND, requireInspectorBuild, supervisorBindingSha256, type InspectorRuntimeConfig } from "@/lib/ebooks/upload/runtime-contract";
import { InspectorAttemptBudget, requireInspectorCgroup } from "@/lib/ebooks/upload/inspector-resources";
import { GiB, MiB, UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";
import { UploadIoGate } from "@/lib/ebooks/upload/io-gate";

export const config: InspectorRuntimeConfig = { dockerExecutable: "/usr/bin/docker", dockerSocket: "/private/engine/docker.sock",
  dockerConfigDirectory: "/private/engine/config", image: `durtal/inspector@sha256:${"a".repeat(64)}`, spoolRoot: "/private/spool", uid: 1001, gid: 1001 };
export const identity = { volumeId: "11111111-1111-4111-8111-111111111111", bindingSha256: "b".repeat(64),
  fence: { operationId: "22222222-2222-4222-8222-222222222222", ownerToken: "33333333-3333-4333-8333-333333333333", ownerFence: 7, generation: 2 } };

function container(status = "created") {
  return { Id: "c".repeat(64), Name: `/${inspectorName(identity)}`,
    Config: { Image: config.image, User: "1001:1001", WorkingDir: "/scratch", Entrypoint: [INSPECTOR_COMMAND[0]], Cmd: INSPECTOR_COMMAND.slice(1),
      OpenStdin: false, Tty: false, Labels: inspectorLabels(identity, config.image), Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "NODE_ENV=production", "TMPDIR=/scratch", "HOME=/scratch", "HOSTNAME=ebook-inspector", "UV_THREADPOOL_SIZE=2", "MALLOC_ARENA_MAX=2"] },
    HostConfig: { Privileged: false, ReadonlyRootfs: true, NetworkMode: "none", IpcMode: "private", PidMode: "", CgroupnsMode: "private",
      CapAdd: null, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"], RestartPolicy: { Name: "no" }, LogConfig: { Type: "none" },
      Memory: 768 * MiB, MemorySwap: 768 * MiB, NanoCpus: 1_000_000_000, PidsLimit: 16, ShmSize: MiB, OomKillDisable: false, Binds: null, Devices: null,
      Tmpfs: { "/scratch": "rw,noexec,nosuid,nodev,size=268435456,mode=0700,uid=1001,gid=1001" },
      Ulimits: [{ Name: "nofile", Soft: 64, Hard: 64 }, { Name: "core", Soft: 0, Hard: 0 }, { Name: "fsize", Soft: 64 * MiB, Hard: 64 * MiB }] },
    Mounts: [{ Type: "bind", Source: `${config.spoolRoot}/${identity.fence.operationId}/assembled/source`, Destination: "/input/source", RW: false, Propagation: "rprivate" },
      { Type: "bind", Source: `${config.spoolRoot}/${identity.fence.operationId}/metadata/request-7-2.json`, Destination: "/input/request.json", RW: false, Propagation: "rprivate" }],
    State: { Status: status, ExitCode: 0, OOMKilled: false, Paused: false, Restarting: false, Dead: false, Running: status === "running", Pid: status === "running" ? 100 : 0 } };
}

describe("owned inspector boundary", () => {
  it("builds a pinned, unprivileged create command with readonly source and request mounts", () => {
    const args = inspectorCreateArguments(config, identity);
    expect(args).toContain("--pull=never"); expect(args).toContain("--network=none"); expect(args).toContain("--log-driver=none");
    expect(args.filter((arg) => arg === "--mount")).toHaveLength(2);
    expect(args.join(" ")).not.toMatch(/docker\.sock|DATABASE_URL|AWS_|--privileged|--rm|seccomp=unconfined/);
    expect(() => inspectorCreateArguments({ ...config, image: "durtal:latest" }, identity)).toThrow("digest");
    expect(() => inspectorCreateArguments({ ...config, spoolRoot: "/private/a,b" }, identity)).toThrow("path");
  });
  it("accepts exact runtime proof and rejects changed mounts, fences and resource bounds", () => {
    expect(verifyInspectorContainer(container(), config, identity).status).toBe("created");
    const cases = [
      (c: ReturnType<typeof container>) => { c.HostConfig.Memory = GiB; },
      (c: ReturnType<typeof container>) => { c.HostConfig.NetworkMode = "host"; },
      (c: ReturnType<typeof container>) => { c.HostConfig.PidMode = "host"; },
      (c: ReturnType<typeof container>) => { c.HostConfig.Privileged = true; },
      (c: ReturnType<typeof container>) => { c.HostConfig.LogConfig.Type = "json-file"; },
      (c: ReturnType<typeof container>) => { c.Mounts[0].RW = true; },
      (c: ReturnType<typeof container>) => { c.Mounts[1].RW = true; },
      (c: ReturnType<typeof container>) => { c.Mounts[1].Source = c.Mounts[1].Source.replace("request-7-2", "request-7-1"); },
      (c: ReturnType<typeof container>) => { c.Mounts.pop(); },
      (c: ReturnType<typeof container>) => { c.Mounts.push({ ...c.Mounts[0], Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock" }); },
      (c: ReturnType<typeof container>) => { c.Config.Labels["io.durtal.ebook-inspector.fence"] = "6"; },
      (c: ReturnType<typeof container>) => { c.Config.Env.push("DATABASE_URL=forbidden"); },
      (c: ReturnType<typeof container>) => { c.State.Pid = 100; },
    ];
    for (const change of cases) { const raw = container(); change(raw); expect(() => verifyInspectorContainer(raw, config, identity)).toThrow(); }
  });
  it("says why the worker stopped, on one bounded line", () => {
    expect(inspectorFailureDetail({ status: "exited", exitCode: 1, oomKilled: false }, 1, "Cannot find package '@/lib'\n  at resolve\n"))
      .toBe(" (exited, exit 1, docker 1): Cannot find package '@/lib' at resolve");
    expect(inspectorFailureDetail({ status: "exited", exitCode: 137, oomKilled: true }, 0, "")).toBe(" (exited, exit 137, out of memory)");
    expect(inspectorFailureDetail({ status: "running", exitCode: 0, oomKilled: false }, 0, "a\u202eb\u200bc")).toBe(" (running, exit 0): a b c");
    expect(inspectorFailureDetail({ status: "exited", exitCode: 2, oomKilled: false }, 0, "x".repeat(4096))).toHaveLength(" (exited, exit 2): ".length + 512);
  });
  it("refuses unverified controllers before any create/start command", async () => {
    const run = vi.fn(); const runtime = new OwnedInspectorRuntime(config, { run });
    await expect(runtime.create(identity)).rejects.toThrow("readiness");
    await expect(runtime.execute(identity, new AbortController().signal)).rejects.toThrow("readiness");
    expect(run).not.toHaveBeenCalled();
  });
  it("recovers a prior pinned image only for cleanup, preserving isolation checks", async () => {
    const oldImage = `durtal/inspector@sha256:${"d".repeat(64)}`;
    const raw = container("exited"); raw.Config.Image = oldImage;
    // The previously shipped source recorded its image in Config.Image only.
    delete raw.Config.Labels["io.durtal.ebook-inspector.image"];
    delete raw.Config.Labels["io.durtal.ebook-inspector.request"]; raw.Mounts.pop();
    const run = vi.fn(async (args: readonly string[]) => ({ stdout: args[1] === "ls" ? raw.Id : args[1] === "inspect" ? JSON.stringify([raw]) : "", stderr: "", exitCode: 0 }));
    const runtime = new OwnedInspectorRuntime(config, { run });
    const found = await runtime.inventory(identity.volumeId, identity.bindingSha256);
    expect(found).toHaveLength(1); expect(found[0].image).toBe(oldImage);
    await runtime.stop(identity, found[0].image); await runtime.remove(identity, found[0].image);
    await expect(runtime.inspect(identity)).rejects.toThrow("differs");
    expect(run.mock.calls.some(([args]) => args[1] === "start")).toBe(false);
    raw.Config.Labels["io.durtal.ebook-inspector.image"] = config.image;
    await expect(runtime.inventory(identity.volumeId, identity.bindingSha256)).rejects.toThrow("differs");
    raw.Config.Labels["io.durtal.ebook-inspector.image"] = oldImage;
    raw.Mounts[0].RW = true;
    await expect(runtime.inventory(identity.volumeId, identity.bindingSha256)).rejects.toThrow("differs");
  });
  it("cancels an in-flight inventory command and never advances to another container", async () => {
    const abort = new AbortController();
    let inspecting!: () => void;
    const begun = new Promise<void>((resolve) => { inspecting = resolve; });
    const run = vi.fn<RuntimeCommands["run"]>(async (args, options) => {
      if (args[1] === "ls") return { stdout: `${"c".repeat(64)}\n${"d".repeat(64)}`, stderr: "", exitCode: 0 };
      expect(options?.signal).toBe(abort.signal); inspecting();
      return new Promise((_, reject) => options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
    });
    const pending = new OwnedInspectorRuntime(config, { run }).inventory(identity.volumeId, identity.bindingSha256, abort.signal);
    const rejected = expect(pending).rejects.toThrow("deadline");
    await begun; abort.abort(new Error("inventory deadline")); await rejected;
    expect(run).toHaveBeenCalledTimes(2);
    await expect(new OwnedInspectorRuntime(config, { run }).inventory(identity.volumeId, identity.bindingSha256, abort.signal)).rejects.toThrow("deadline");
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("checks required hard controllers and seccomp rather than ignoring warnings", async () => {
    const info = { OSType: "linux", CgroupVersion: "2", MemoryLimit: true, SwapLimit: true, CpuCfsQuota: true, PidsLimit: true,
      Warnings: [], SecurityOptions: ["name=seccomp,profile=builtin"] };
    for (const change of [{ MemoryLimit: false }, { SwapLimit: false }, { CgroupVersion: "1" }, { Warnings: ["No swap support"] }, { SecurityOptions: [] }]) {
      const commands: RuntimeCommands = { run: vi.fn(async () => ({ stdout: JSON.stringify({ ...info, ...change }), stderr: "", exitCode: 0 })) };
      await expect(new OwnedInspectorRuntime(config, commands).preflight()).rejects.toThrow();
      expect(commands.run).toHaveBeenCalledTimes(1);
    }
  });
  it("reinspects after a lost stop response and force kills only the verified tree", async () => {
    let inspections = 0;
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "inspect") return { stdout: JSON.stringify([container(++inspections < 3 ? "running" : "exited")]), stderr: "", exitCode: 0 };
      if (args[1] === "stop") throw new Error("lost stop response");
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const state = await new OwnedInspectorRuntime(config, { run }).stop(identity);
    expect(state.status).toBe("exited"); expect(inspections).toBe(3);
    expect(run.mock.calls.some(([args]) => args[1] === "kill")).toBe(true);
    expect(run.mock.calls.every(([args]) => !args.includes("--force"))).toBe(true);
  });
  it("holds resources when inspect still reports a process after force termination", async () => {
    const run = vi.fn(async (args: readonly string[]) => ({ stdout: args[1] === "inspect" ? JSON.stringify([container("running")]) : "", stderr: "", exitCode: 0 }));
    await expect(new OwnedInspectorRuntime(config, { run }).stop(identity)).rejects.toThrow("unproved");
    expect(run.mock.calls.some(([args]) => args[1] === "rm")).toBe(false);
  });
  it("refuses a legacy engine without independently verified bounded hooks", () => {
    expect(() => requireInspectorBuild(config, { image: config.image, sourceRevision: "a".repeat(40), protocol: 1,
      cgroupLimitsBeforeParsing: true,
      archiveDirectoryBeforeListing: true, actualDecodedBytesBeforeRetention: false, retainedTextBeforeAllocation: true,
      nativeImageBudgetBeforeDecode: true, pdfTextDeadline: true, boundedOutput: true, noCloudOrDatabaseCredentials: true })).toThrow("shared inspector");
  });
  it("binds ownership to the configured host, port, source tree and engine without freezing image upgrades", () => {
    const binding = { volumeId: identity.volumeId, hostId: "66666666-6666-4666-8666-666666666666", ownershipPort: 45506, runtime: config };
    const original = supervisorBindingSha256(binding);
    expect(supervisorBindingSha256({ ...binding, ownershipPort: 45507 })).not.toBe(original);
    expect(supervisorBindingSha256({ ...binding, runtime: { ...config, spoolRoot: "/private/other" } })).not.toBe(original);
    expect(supervisorBindingSha256({ ...binding, runtime: { ...config, image: `durtal/inspector@sha256:${"d".repeat(64)}` } })).toBe(original);
  });
});

describe("actual inspector resource accounting", () => {
  it("requires finite memory, no swap, process and CPU cgroup ceilings", () => {
    const values = { memoryMax: `${768 * MiB}\n`, memorySwapMax: "0\n", pidsMax: "16\n", cpuMax: "100000 100000\n" };
    requireInspectorCgroup(values);
    for (const change of [{ memoryMax: "max\n" }, { memoryMax: `${GiB}` }, { memorySwapMax: "1" }, { pidsMax: "max" }, { cpuMax: "max 100000" }, { cpuMax: "200000 100000" }])
      expect(() => requireInspectorCgroup({ ...values, ...change })).toThrow();
  });
  it("charges actual redecoding and simultaneous text/native retention", () => {
    const budget = new InspectorAttemptBudget();
    budget.decodedChunk("entry", 64 * MiB);
    expect(() => budget.decodedChunk("entry", 1)).toThrow("entry bytes");
    expect(() => budget.assertHealthy()).toThrow("entry bytes");
    const total = new InspectorAttemptBudget();
    for (const id of ["first", "second", "third", "fourth"]) total.decodedChunk(id, 64 * MiB);
    expect(() => total.decodedChunk("fifth", 1)).toThrow("cumulative");
    const texts = new InspectorAttemptBudget();
    const text = texts.retainText(UPLOAD_LIMITS.retainedTextCodeUnits);
    expect(() => texts.retainText(1)).toThrow("retained text"); text(); text();
    const images = new InspectorAttemptBudget();
    const native = images.imageAllocation(4096, 4096, 128 * MiB);
    expect(() => images.imageAllocation(1, 1, 1)).toThrow("native image"); native(); native();
    expect(images.snapshot()).toEqual({ decodedBytes: 0, retainedTextCodeUnits: 0, nativeBytes: 0 });
  });
});

describe("owned I/O quiescence", () => {
  it("blocks admission measurement until an aborted writer and stream actually settle", async () => {
    const gate = new UploadIoGate(); gate.open(identity.fence);
    let finish!: () => void; let closed!: () => void;
    const writer = gate.writer(identity.fence, async (signal, track) => { closed = track(); await new Promise<void>((resolve) => { finish = resolve; }); expect(signal.aborted).toBe(true); closed(); });
    gate.quiesce();
    expect(gate.snapshot()).toMatchObject({ activeWriters: 1, streamsClosed: false, pendingIoSettled: false });
    let measured = false;
    const barrier = gate.barrier(async () => { measured = true; });
    await Promise.resolve(); expect(measured).toBe(false);
    finish(); await writer; await barrier;
    expect(gate.snapshot()).toMatchObject({ activeWriters: 0, streamsClosed: true, pendingIoSettled: true });
  });
  it("refuses old owners and holds a missing stream-close proof", async () => {
    const gate = new UploadIoGate(); gate.open(identity.fence);
    await expect(gate.writer({ ...identity.fence, ownerFence: 6 }, async () => {})).rejects.toThrow("quiescing");
    let close!: () => void;
    await gate.writer(identity.fence, async (_, track) => { close = track(); });
    expect(gate.snapshot()).toMatchObject({ accepting: false, streamsClosed: false });
    await expect(gate.drain(1)).rejects.toThrow("remain held"); close(); await gate.drain();
  });
});
