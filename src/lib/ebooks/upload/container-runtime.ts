import { spawn } from "node:child_process";
import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import { requireInspectorIsolation } from "./inspection-policy";
import { InspectorOutputProtocol } from "./inspector-protocol";
import { INSPECTOR_COMMAND, INSPECTOR_LABEL, INSPECTOR_PROTOCOL, inspectorCreateArguments, inspectorLabels, inspectorName,
  sourcePath, requestPath, validateInspectorIdentity, validateRuntimeConfig, requireUuid, requireSha256, requireInspectorImage, type InspectorIdentity, type InspectorRuntimeConfig } from "./runtime-contract";

export interface CommandResult { stdout: string; stderr: string; exitCode: number }
export interface RuntimeCommands {
  run(args: readonly string[], options?: { signal?: AbortSignal; timeoutMs?: number; outputBytes?: number; onStdout?: (chunk: Uint8Array) => void }): Promise<CommandResult>;
}

/** Fixed executable and daemon socket; no shell, caller env, stdin or credential inheritance. */
export class OwnedDockerCommands implements RuntimeCommands {
  constructor(private readonly config: InspectorRuntimeConfig) { validateRuntimeConfig(config); }
  async run(args: readonly string[], options: { signal?: AbortSignal; timeoutMs?: number; outputBytes?: number; onStdout?: (chunk: Uint8Array) => void } = {}): Promise<CommandResult> {
    const timeoutMs = checkedInteger(options.timeoutMs ?? 10_000, "runtime command timeout", 1, UPLOAD_LIMITS.jobMs);
    const outputBytes = checkedInteger(options.outputBytes ?? 64 * 1024, "runtime command output", 1, UPLOAD_LIMITS.reportBytes);
    options.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.dockerExecutable, ["--host", `unix://${this.config.dockerSocket}`, ...args], {
        stdio: ["ignore", "pipe", "pipe"], shell: false, cwd: this.config.dockerConfigDirectory,
        env: { NODE_ENV: "production", PATH: "/usr/bin:/bin", DOCKER_CONFIG: this.config.dockerConfigDirectory, LANG: "C.UTF-8" },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let failure: unknown;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (reason: unknown) => {
        if (failure) return;
        failure = reason;
        child.kill("SIGTERM");
        forceTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      };
      const capture = (target: Buffer[]) => (buffer: Buffer) => {
        bytes += buffer.length;
        if (bytes > outputBytes) stop(new Error("Inspector control output limit exceeded"));
        else {
          target.push(buffer);
          if (target === stdout && !failure) try { options.onStdout?.(buffer); } catch (error) { stop(error); }
        }
      };
      child.stdout.on("data", capture(stdout));
      child.stderr.on("data", capture(stderr));
      const abort = () => stop(options.signal?.reason ?? new Error("Inspector control aborted"));
      options.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => stop(new Error("Inspector control deadline expired")), timeoutMs);
      child.on("error", (error) => { failure = error; });
      // close proves local pipes closed. It says nothing about the container tree.
      child.once("close", (code) => {
        clearTimeout(timer);
        clearTimeout(forceTimer);
        options.signal?.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: code ?? -1 });
      });
      if (options.signal?.aborted) abort();
    });
  }
}

export interface InspectorContainerState {
  id: string;
  /** Recorded digest is accepted only for cleanup, never for execution. */
  image?: string;
  identity: InspectorIdentity;
  status: "created" | "running" | "exited";
  exitCode: number;
  oomKilled: boolean;
}

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed inspector runtime object");
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new Error("Malformed inspector runtime list"); return value; };
const equal = (value: unknown, expected: unknown) => { if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error("Inspector runtime configuration differs"); };

/** Inspect before start, before signalling, and after exit. Labels alone aren't ownership. */
export function verifyInspectorContainer(raw: unknown, config: InspectorRuntimeConfig, identity: InspectorIdentity, cleanupImage?: string): InspectorContainerState {
  validateRuntimeConfig(config);
  validateInspectorIdentity(identity);
  const root = object(raw);
  const settings = object(root.Config);
  const host = object(root.HostConfig);
  const state = object(root.State);
  const labels = object(settings.Labels);
  const image = cleanupImage ?? config.image;
  requireInspectorImage(image);
  for (const [key, value] of Object.entries(inspectorLabels(identity))) equal(labels[key], value);
  // Earlier owned containers recorded the digest in Config.Image only. Cleanup
  // accepts that immutable engine metadata; newly created containers label it too.
  if (cleanupImage === undefined || labels[`${INSPECTOR_LABEL}.image`] !== undefined) equal(labels[`${INSPECTOR_LABEL}.image`], image);
  if (typeof root.Id !== "string" || !/^[a-f0-9]{64}$/.test(root.Id)) throw new Error("Invalid inspector container id");
  equal(root.Name, `/${inspectorName(identity)}`);
  equal(settings.Image, image);
  equal(settings.User, `${config.uid}:${config.gid}`);
  equal(settings.WorkingDir, "/scratch");
  equal(settings.Entrypoint, [INSPECTOR_COMMAND[0]]);
  equal(settings.Cmd, INSPECTOR_COMMAND.slice(1));
  equal(settings.OpenStdin, false);
  equal(settings.Tty, false);
  const environment = array(settings.Env);
  // Base images may supply PATH/NODE_VERSION/YARN_VERSION only. Never cloud/DB/proxy env.
  const allowed = new Set(["PATH", "NODE_VERSION", "YARN_VERSION", "NODE_ENV", "TMPDIR", "HOME", "HOSTNAME", "UV_THREADPOOL_SIZE", "MALLOC_ARENA_MAX"]);
  const seen = new Set<string>();
  for (const entry of environment) {
    if (typeof entry !== "string") throw new Error("Invalid inspector environment");
    const key = entry.split("=", 1)[0];
    if (!allowed.has(key) || seen.has(key)) throw new Error("Unexpected inspector environment");
    seen.add(key);
  }
  for (const entry of ["NODE_ENV=production", "TMPDIR=/scratch", "HOME=/scratch", "UV_THREADPOOL_SIZE=2", "MALLOC_ARENA_MAX=2"])
    if (!environment.includes(entry)) throw new Error("Inspector environment differs");
  if (labels[`${INSPECTOR_LABEL}.request`] === "1" && !environment.includes("HOSTNAME=ebook-inspector")) throw new Error("Inspector hostname differs");
  equal(host.Privileged, false);
  equal(host.ReadonlyRootfs, true);
  equal(host.NetworkMode, "none");
  equal(host.IpcMode, "private");
  equal(host.PidMode, "");
  equal(host.CgroupnsMode, "private");
  equal(host.CapAdd, null);
  equal(host.CapDrop, ["ALL"]);
  const security = array(host.SecurityOpt);
  if (security.length !== 1 || !["no-new-privileges", "no-new-privileges=true"].includes(String(security[0]))) throw new Error("Inspector security options differ");
  equal(object(host.RestartPolicy).Name, "no");
  equal(object(host.LogConfig).Type, "none");
  equal(host.Memory, UPLOAD_LIMITS.processTreeMemoryBytes);
  equal(host.MemorySwap, UPLOAD_LIMITS.processTreeMemoryBytes);
  equal(host.NanoCpus, 1_000_000_000);
  equal(host.PidsLimit, 16);
  equal(host.ShmSize, 1024 * 1024);
  if (host.OomKillDisable === true || (host.Binds !== null && array(host.Binds).length) || (host.Devices !== null && array(host.Devices).length))
    throw new Error("Inspector has unexpected host access");
  const mounts = array(root.Mounts).map(object);
  // Docker's /scratch tmpfs can appear in Mounts depending on engine version.
  const binds = mounts.filter((mount) => mount.Type !== "tmpfs");
  const requestBound = labels[`${INSPECTOR_LABEL}.request`] === "1";
  if ((!requestBound && (cleanupImage === undefined || labels[`${INSPECTOR_LABEL}.request`] !== undefined))
    || binds.length !== (requestBound ? 2 : 1)) throw new Error("Inspector host mounts differ");
  const source = binds.find((mount) => mount.Destination === "/input/source");
  if (!source) throw new Error("Inspector original mount missing");
  equal(source.Type, "bind"); equal(source.Source, sourcePath(config, identity)); equal(source.Destination, "/input/source");
  equal(source.RW, false); equal(source.Propagation, "rprivate");
  if (requestBound) {
    const request = binds.find((mount) => mount.Destination === "/input/request.json");
    if (!request) throw new Error("Inspector request mount missing");
    equal(request.Type, "bind"); equal(request.Source, requestPath(config, identity)); equal(request.RW, false); equal(request.Propagation, "rprivate");
  }
  for (const mount of mounts.filter((mount) => mount.Type === "tmpfs")) equal(mount.Destination, "/scratch");
  equal(host.Tmpfs, { "/scratch": `rw,noexec,nosuid,nodev,size=${UPLOAD_LIMITS.scratchBytes},mode=0700,uid=${config.uid},gid=${config.gid}` });
  const ulimits = array(host.Ulimits).map(object);
  for (const [Name, size] of [["nofile", 64], ["core", 0], ["fsize", UPLOAD_LIMITS.entryDecodedBytes]] as const) {
    if (!ulimits.some((limit) => limit.Name === Name && limit.Soft === size && limit.Hard === size)) throw new Error("Inspector ulimit differs");
  }
  if (ulimits.length !== 3) throw new Error("Unexpected inspector ulimit");
  if (!(["created", "running", "exited"] as unknown[]).includes(state.Status) || typeof state.ExitCode !== "number" || typeof state.OOMKilled !== "boolean"
    || state.Paused !== false || state.Restarting !== false || state.Dead !== false || state.Running !== (state.Status === "running"))
    throw new Error("Unknown inspector lifecycle state");
  checkedInteger(state.ExitCode, "inspector exit code", 0, 255);
  if (state.Status !== "running" && state.Pid !== 0) throw new Error("Inspector process tree exit is not confirmed");
  return { id: root.Id, image, identity, status: state.Status as InspectorContainerState["status"], exitCode: state.ExitCode, oomKilled: state.OOMKilled };
}

export class OwnedInspectorRuntime {
  private controllersVerified = false;
  constructor(private readonly config: InspectorRuntimeConfig, private readonly commands: RuntimeCommands) { validateRuntimeConfig(config); }

  async preflight(): Promise<void> {
    this.controllersVerified = false;
    const result = await this.checked(["info", "--format", "{{json .}}"]);
    const info = object(JSON.parse(result.stdout));
    // Cgroup v2 and all hard controllers are required. Warnings are not waived.
    if (info.OSType !== "linux" || info.CgroupVersion !== "2" || info.MemoryLimit !== true || info.SwapLimit !== true
      || info.CpuCfsQuota !== true || info.PidsLimit !== true || array(info.Warnings ?? []).length)
      throw new Error("Inspector OS process-tree controllers unavailable");
    if (!array(info.SecurityOptions).some((value) => typeof value === "string" && value.startsWith("name=seccomp,")))
      throw new Error("Inspector default seccomp is unavailable");
    await this.checked(["image", "inspect", this.config.image]); // no pull/install
    this.controllersVerified = true;
  }

  async inspect(identity: InspectorIdentity, cleanupImage?: string, signal?: AbortSignal): Promise<InspectorContainerState> {
    const result = await this.checked(["container", "inspect", inspectorName(identity)], signal);
    const list = array(JSON.parse(result.stdout));
    if (list.length !== 1) throw new Error("Inspector lookup is not unique");
    return verifyInspectorContainer(list[0], this.config, identity, cleanupImage);
  }

  /** Scan *all* prior owner generations on this volume, including exited containers. */
  async inventory(volumeId: string, bindingSha256: string, signal?: AbortSignal): Promise<InspectorContainerState[]> {
    requireUuid(volumeId); requireSha256(bindingSha256);
    const result = await this.checked(["container", "ls", "--all", "--no-trunc", "--filter", `label=${INSPECTOR_LABEL}`,
      "--filter", `label=${INSPECTOR_LABEL}.volume=${volumeId}`, "--format", "{{.ID}}"], signal);
    const ids = result.stdout.trim() ? result.stdout.trim().split("\n") : [];
    if (ids.length > 1024 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw new Error("Inspector inventory is not bounded");
    const states: InspectorContainerState[] = [];
    for (const id of ids) {
      const response = await this.checked(["container", "inspect", id], signal);
      const list = array(JSON.parse(response.stdout));
      if (list.length !== 1) throw new Error("Inspector inventory changed");
      const settings = object(object(list[0]).Config);
      const labels = object(settings.Labels);
      if (typeof settings.Image !== "string") throw new Error("Inspector recorded image missing");
      const get = (key: string): string => { const value = labels[`${INSPECTOR_LABEL}.${key}`]; if (typeof value !== "string") throw new Error("Inspector identity missing"); return value; };
      const number = (key: string) => { const value = get(key); if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Inspector fence malformed"); return checkedInteger(Number(value), key); };
      if (labels[INSPECTOR_LABEL] !== String(INSPECTOR_PROTOCOL) || get("volume") !== volumeId || get("binding") !== bindingSha256)
        throw new Error("Inspector volume binding differs");
      states.push(verifyInspectorContainer(list[0], this.config, { volumeId, bindingSha256,
        fence: { operationId: get("operation"), ownerToken: get("owner"), ownerFence: number("fence"), generation: number("generation") } }, settings.Image));
    }
    signal?.throwIfAborted();
    return states;
  }

  async create(identity: InspectorIdentity): Promise<InspectorContainerState> {
    if (!this.controllersVerified) throw new Error("Inspector controllers have not passed readiness");
    await this.checked(inspectorCreateArguments(this.config, identity));
    const state = await this.inspect(identity);
    if (state.status !== "created") throw new Error("Inspector was started before verification");
    requireInspectorIsolation({ processTreeMemoryLimitBytes: UPLOAD_LIMITS.processTreeMemoryBytes, nodeHeapLimitBytes: UPLOAD_LIMITS.v8HeapBytes,
      osMemoryLimitVerified: true, entireProcessTreeBound: true, ownedIdentityVerified: true, cpuLimit: 1, processLimit: 16 });
    return state;
  }

  /** Bounded stdout protocol only. A failed/aborted attachment is not exit evidence. */
  async execute(identity: InspectorIdentity, signal: AbortSignal): Promise<string> {
    if (!this.controllersVerified) throw new Error("Inspector controllers have not passed readiness");
    const before = await this.inspect(identity);
    if (before.status !== "created") throw new Error("Inspector cannot be started twice");
    const deadline = new AbortController();
    let pdfTimer: ReturnType<typeof setTimeout> | undefined;
    const protocol = new InspectorOutputProtocol((phase) => {
      if (phase === "start") pdfTimer = setTimeout(() => deadline.abort(new Error("Inspector PDF text wall deadline expired")), UPLOAD_LIMITS.pdfTextMs);
      else clearTimeout(pdfTimer);
    });
    try {
      const combined = AbortSignal.any([signal, deadline.signal]);
      const response = await this.commands.run(["container", "start", "--attach", inspectorName(identity)],
        { signal: combined, timeoutMs: UPLOAD_LIMITS.inspectionMs, outputBytes: UPLOAD_LIMITS.reportBytes, onStdout: (chunk) => protocol.write(chunk) });
      combined.throwIfAborted();
      const after = await this.inspect(identity);
      if (response.exitCode !== 0 || after.status !== "exited" || after.exitCode !== 0 || after.oomKilled || response.stderr)
        throw new Error("Inspector did not complete successfully");
      return protocol.finish();
    } finally { clearTimeout(pdfTimer); }
  }

  async stop(identity: InspectorIdentity, cleanupImage?: string, signal?: AbortSignal): Promise<InspectorContainerState> {
    let state = await this.inspect(identity, cleanupImage, signal);
    if (state.status === "running") {
      // Docker stop waits the grace period, then SIGKILLs the container tree.
      try {
        await this.commands.run(["container", "stop", "--time", String(UPLOAD_LIMITS.terminationGraceMs / 1000), inspectorName(identity)],
          { timeoutMs: UPLOAD_LIMITS.terminationGraceMs + 5000, signal });
      } catch { /* A lost/failed control response is not exit proof. Reinspect. */ }
      state = await this.inspect(identity, cleanupImage, signal);
      if (state.status === "running") {
        await this.checked(["container", "kill", "--signal=KILL", inspectorName(identity)], signal);
        state = await this.inspect(identity, cleanupImage, signal);
      }
    }
    if (state.status === "running") throw new Error("Inspector exit is unproved; resources remain held");
    return state;
  }

  async remove(identity: InspectorIdentity, cleanupImage?: string, signal?: AbortSignal): Promise<void> {
    if ((await this.inspect(identity, cleanupImage, signal)).status === "running") throw new Error("Cannot remove a running inspector");
    await this.checked(["container", "rm", inspectorName(identity)], signal); // never --force
  }

  private async checked(args: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    signal?.throwIfAborted();
    const result = await this.commands.run(args, { signal });
    signal?.throwIfAborted();
    if (result.exitCode !== 0) throw new Error("Inspector runtime command failed");
    return result;
  }
}
