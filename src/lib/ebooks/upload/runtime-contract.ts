import path from "node:path";
import { createHash } from "node:crypto";
import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import { validateFence, type OperationFence } from "./lifecycle";

export const INSPECTOR_PROTOCOL = 1;
export const INSPECTOR_LABEL = "io.durtal.ebook-inspector";
export const INSPECTOR_COMMAND = Object.freeze(["node", "--max-old-space-size=256", "/inspector/worker.mjs"]);

export interface InspectorIdentity {
  volumeId: string;
  bindingSha256: string;
  fence: OperationFence;
}

export function requireUuid(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error("Invalid runtime UUID");
}

export function requireSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid runtime SHA-256");
}

export function validateInspectorIdentity(identity: InspectorIdentity): void {
  requireUuid(identity.volumeId);
  requireSha256(identity.bindingSha256);
  validateFence(identity.fence);
  requireUuid(identity.fence.operationId);
  requireUuid(identity.fence.ownerToken);
}

export function inspectorName(identity: InspectorIdentity): string {
  validateInspectorIdentity(identity);
  return `durtal-inspect-${identity.volumeId}-${identity.fence.operationId}-${identity.fence.ownerFence}-${identity.fence.generation}`;
}

export function requireInspectorImage(image: string): void {
  if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Inspector image must be pinned by digest");
}

export function inspectorLabels(identity: InspectorIdentity, image?: string): Record<string, string> {
  validateInspectorIdentity(identity);
  if (image !== undefined) requireInspectorImage(image);
  return {
    [INSPECTOR_LABEL]: String(INSPECTOR_PROTOCOL),
    [`${INSPECTOR_LABEL}.volume`]: identity.volumeId,
    [`${INSPECTOR_LABEL}.binding`]: identity.bindingSha256,
    [`${INSPECTOR_LABEL}.operation`]: identity.fence.operationId,
    [`${INSPECTOR_LABEL}.owner`]: identity.fence.ownerToken,
    [`${INSPECTOR_LABEL}.fence`]: String(identity.fence.ownerFence),
    [`${INSPECTOR_LABEL}.generation`]: String(identity.fence.generation),
    ...(image === undefined ? {} : { [`${INSPECTOR_LABEL}.image`]: image, [`${INSPECTOR_LABEL}.request`]: "1" }),
  };
}

/** Kept outside Next.js: only the owned host supervisor receives CLI/engine access. */
export interface InspectorRuntimeConfig {
  dockerExecutable: string;
  dockerSocket: string;
  dockerConfigDirectory: string;
  image: string;
  spoolRoot: string;
  uid: number;
  gid: number;
}

export function requirePrivateAbsolutePath(value: string): void {
  if (!path.isAbsolute(value) || path.normalize(value) !== value || value === "/"
    || /[\x00-\x1f,]/.test(value)) throw new Error("Invalid private runtime path");
}

export function validateRuntimeConfig(config: InspectorRuntimeConfig): void {
  for (const value of [config.dockerExecutable, config.dockerSocket, config.dockerConfigDirectory, config.spoolRoot]) requirePrivateAbsolutePath(value);
  requireInspectorImage(config.image);
  checkedInteger(config.uid, "inspector uid", 1, 2 ** 31 - 1);
  checkedInteger(config.gid, "inspector gid", 1, 2 ** 31 - 1);
}

/** Stable across inspector image upgrades; changes require an unused/new volume. */
export function supervisorBindingSha256(input: {
  volumeId: string; hostId: string; ownershipPort: number; runtime: InspectorRuntimeConfig;
}): string {
  requireUuid(input.volumeId); requireUuid(input.hostId); validateRuntimeConfig(input.runtime);
  checkedInteger(input.ownershipPort, "supervisor ownership port", 1024, 65535);
  return createHash("sha256").update(JSON.stringify({ protocol: INSPECTOR_PROTOCOL, volumeId: input.volumeId, hostId: input.hostId,
    ownershipPort: input.ownershipPort, spoolRoot: input.runtime.spoolRoot, uid: input.runtime.uid, gid: input.runtime.gid,
    engineSocket: input.runtime.dockerSocket })).digest("hex");
}

/** Build provenance must attest to hooks in the actual shared 494 engine. */
export interface InspectorBuildEvidence {
  image: string;
  sourceRevision: string;
  protocol: number;
  cgroupLimitsBeforeParsing: boolean;
  archiveDirectoryBeforeListing: boolean;
  actualDecodedBytesBeforeRetention: boolean;
  retainedTextBeforeAllocation: boolean;
  nativeImageBudgetBeforeDecode: boolean;
  pdfTextDeadline: boolean;
  boundedOutput: boolean;
  noCloudOrDatabaseCredentials: boolean;
}

export function requireInspectorBuild(config: InspectorRuntimeConfig, evidence: InspectorBuildEvidence): void {
  validateRuntimeConfig(config);
  if (evidence.image !== config.image || !/^[a-f0-9]{40}$/.test(evidence.sourceRevision) || evidence.protocol !== INSPECTOR_PROTOCOL
    || !evidence.cgroupLimitsBeforeParsing
    || !evidence.archiveDirectoryBeforeListing || !evidence.actualDecodedBytesBeforeRetention
    || !evidence.retainedTextBeforeAllocation || !evidence.nativeImageBudgetBeforeDecode
    || !evidence.pdfTextDeadline || !evidence.boundedOutput || !evidence.noCloudOrDatabaseCredentials)
    throw new Error("Bounded shared inspector build is not verified");
}

export function sourcePath(config: InspectorRuntimeConfig, identity: InspectorIdentity): string {
  validateRuntimeConfig(config);
  validateInspectorIdentity(identity);
  return path.join(config.spoolRoot, identity.fence.operationId, "assembled", "source");
}

export function requestRelativePath(identity: InspectorIdentity): string {
  validateInspectorIdentity(identity);
  return `${identity.fence.operationId}/metadata/request-${identity.fence.ownerFence}-${identity.fence.generation}.json`;
}
export function requestPath(config: InspectorRuntimeConfig, identity: InspectorIdentity): string {
  validateRuntimeConfig(config);
  return path.join(config.spoolRoot, requestRelativePath(identity));
}

/** No writable host mount: derived data leaves through bounded stdout, never logs. */
export function inspectorCreateArguments(config: InspectorRuntimeConfig, identity: InspectorIdentity): string[] {
  const source = sourcePath(config, identity);
  const args = ["container", "create", "--pull=never", "--name", inspectorName(identity),
    "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
    "--memory", String(UPLOAD_LIMITS.processTreeMemoryBytes), "--memory-swap", String(UPLOAD_LIMITS.processTreeMemoryBytes),
    "--cpus=1", "--pids-limit=16", "--ulimit", "nofile=64:64", "--ulimit", "core=0:0",
    "--ulimit", `fsize=${UPLOAD_LIMITS.entryDecodedBytes}:${UPLOAD_LIMITS.entryDecodedBytes}`,
    "--shm-size=1048576", "--ipc=private", "--cgroupns=private", "--restart=no", "--log-driver=none",
    "--user", `${config.uid}:${config.gid}`, "--workdir=/scratch", "--entrypoint=node",
    "--env=NODE_ENV=production", "--env=TMPDIR=/scratch", "--env=HOME=/scratch",
    "--env=HOSTNAME=ebook-inspector",
    "--env=UV_THREADPOOL_SIZE=2", "--env=MALLOC_ARENA_MAX=2",
    "--mount", `type=bind,source=${source},target=/input/source,readonly,bind-propagation=rprivate`,
    "--mount", `type=bind,source=${requestPath(config, identity)},target=/input/request.json,readonly,bind-propagation=rprivate`,
    "--tmpfs", `/scratch:rw,noexec,nosuid,nodev,size=${UPLOAD_LIMITS.scratchBytes},mode=0700,uid=${config.uid},gid=${config.gid}`];
  for (const [name, value] of Object.entries(inspectorLabels(identity, config.image))) args.push("--label", `${name}=${value}`);
  args.push(config.image, ...INSPECTOR_COMMAND.slice(1));
  return args;
}
