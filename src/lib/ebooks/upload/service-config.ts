import path from "node:path";
import { lstat, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod/v4";
import { INSPECTOR_PROTOCOL, requireInspectorBuild, supervisorBindingSha256 } from "./runtime-contract";
import type { UploadBridgeConfig } from "./host-bridge";
import type { OwnedUploadServiceConfig } from "./owned-service";

/*
 * The upload service's two private files (SLN-506). The host service reads
 * service.json; the app reads bridge.json (EBOOK_UPLOAD_BRIDGE), which holds
 * only what the app needs to reach the service's socket. Both are written
 * once by `pnpm ebooks:upload-service init`, owned by the user that runs the
 * app and the service, and readable by nobody else.
 */

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const absolute = z.string().min(2).max(1024).refine((value) => path.isAbsolute(value) && path.normalize(value) === value);

export const uploadBridgeConfigSchema = z.object({
  socketPath: absolute, secret: sha256, targetFingerprint: sha256, bindingSha256: sha256,
}).strict();

export const uploadServiceConfigSchema = z.object({
  volumeId: uuid,
  hostId: uuid,
  ownershipPort: z.number().int().min(1024).max(65535),
  runtime: z.object({
    dockerExecutable: absolute, dockerSocket: absolute, dockerConfigDirectory: absolute,
    image: z.string(), spoolRoot: absolute, uid: z.number().int(), gid: z.number().int(),
  }).strict(),
  build: z.object({
    image: z.string(), sourceRevision: z.string().regex(/^[a-f0-9]{40}$/), protocol: z.number().int(),
    cgroupLimitsBeforeParsing: z.boolean(), archiveDirectoryBeforeListing: z.boolean(),
    actualDecodedBytesBeforeRetention: z.boolean(), retainedTextBeforeAllocation: z.boolean(),
    nativeImageBudgetBeforeDecode: z.boolean(), pdfTextDeadline: z.boolean(), boundedOutput: z.boolean(),
    noCloudOrDatabaseCredentials: z.boolean(),
  }).strict(),
  bridge: uploadBridgeConfigSchema,
}).strict();

/** The folders and files of one upload service, under its private state folder. */
export function uploadServicePaths(stateDirectory: string) {
  if (!path.isAbsolute(stateDirectory) || path.normalize(stateDirectory) !== stateDirectory)
    throw new Error("The upload service state folder must be an absolute, normalised path");
  return {
    state: stateDirectory,
    service: path.join(stateDirectory, "service.json"),
    bridge: path.join(stateDirectory, "bridge.json"),
    spool: path.join(stateDirectory, "spool"),
    run: path.join(stateDirectory, "run"),
    socket: path.join(stateDirectory, "run", "bridge.sock"),
    docker: path.join(stateDirectory, "docker"),
  };
}

export interface UploadServiceInput {
  stateDirectory: string;
  volumeId: string;
  hostId: string;
  ownershipPort: number;
  secret: string;
  targetFingerprint: string;
  dockerExecutable: string;
  dockerSocket: string;
  /** Pinned by digest: name@sha256:... */
  image: string;
  sourceRevision: string;
  uid: number;
  gid: number;
}

/**
 * The service's configuration and the app's bridge, bound to each other by the
 * supervisor binding. The build evidence records the inspector built from
 * infra/ebooks/inspector at `sourceRevision`, whose worker carries every bound
 * the supervisor requires (docs/11_DEPLOYMENT.md, Browser uploads).
 */
export function createUploadServiceConfig(input: UploadServiceInput): { service: OwnedUploadServiceConfig; bridge: UploadBridgeConfig } {
  const paths = uploadServicePaths(input.stateDirectory);
  const runtime = {
    dockerExecutable: input.dockerExecutable, dockerSocket: input.dockerSocket, dockerConfigDirectory: paths.docker,
    image: input.image, spoolRoot: paths.spool, uid: input.uid, gid: input.gid,
  };
  const build = {
    image: input.image, sourceRevision: input.sourceRevision, protocol: INSPECTOR_PROTOCOL,
    cgroupLimitsBeforeParsing: true, archiveDirectoryBeforeListing: true, actualDecodedBytesBeforeRetention: true,
    retainedTextBeforeAllocation: true, nativeImageBudgetBeforeDecode: true, pdfTextDeadline: true, boundedOutput: true,
    noCloudOrDatabaseCredentials: true,
  };
  requireInspectorBuild(runtime, build);
  const bindingSha256 = supervisorBindingSha256({ volumeId: input.volumeId, hostId: input.hostId, ownershipPort: input.ownershipPort, runtime });
  const bridge = uploadBridgeConfigSchema.parse({ socketPath: paths.socket, secret: input.secret, targetFingerprint: input.targetFingerprint, bindingSha256 });
  const service = uploadServiceConfigSchema.parse({ volumeId: input.volumeId, hostId: input.hostId, ownershipPort: input.ownershipPort, runtime, build, bridge });
  return { service, bridge };
}

/** A new inspector image keeps the volume, host, port and bridge: the binding does not include the image. */
export function withInspectorImage(service: OwnedUploadServiceConfig, image: string, sourceRevision: string): OwnedUploadServiceConfig {
  const runtime = { ...service.runtime, image };
  const build = { ...service.build, image, sourceRevision };
  requireInspectorBuild(runtime, build);
  const binding = supervisorBindingSha256({ volumeId: service.volumeId, hostId: service.hostId, ownershipPort: service.ownershipPort, runtime });
  if (binding !== service.bridge.bindingSha256) throw new Error("A new inspector image must not change the upload binding");
  return uploadServiceConfigSchema.parse({ ...service, runtime, build });
}

const MAX_CONFIG_BYTES = 16 * 1024;

/**
 * Reads one of the private files: an absolute path to a regular file (no
 * symlink) owned by this user, mode 0600, in a folder only this user can open.
 */
export async function readPrivateConfig<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  if (!path.isAbsolute(file) || path.normalize(file) !== file) throw new Error("Upload config path must be absolute");
  if (await realpath(file) !== file) throw new Error("Upload config path must not pass through a symlink");
  const uid = process.getuid?.();
  const folder = await lstat(path.dirname(file));
  if (!folder.isDirectory() || folder.uid !== uid || (folder.mode & 0o077) !== 0)
    throw new Error("Upload config folder must be private to this user");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600 || info.size > MAX_CONFIG_BYTES)
      throw new Error("Upload config must be a private file (mode 0600) owned by this user");
    return schema.parse(JSON.parse(await handle.readFile("utf8")));
  } finally {
    await handle.close();
  }
}
