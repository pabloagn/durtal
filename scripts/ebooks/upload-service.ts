/**
 * The e-book upload service (SLN-506): the host process that owns browser
 * uploads. The app streams each upload's bytes to it over a private Unix
 * socket; it keeps them in a private spool, checks each file in a locked-down
 * inspector container (no network, read-only, memory/CPU/process bounds), and
 * only then adds or replaces the e-book. Without it, /ebooks/upload answers
 * 503. Run it on the machine that runs the app, as the same user.
 *
 * - `pnpm ebooks:upload-service build-inspector`: builds the inspector image
 *   from infra/ebooks/inspector at this checkout and prints its pinned name.
 * - `pnpm ebooks:upload-service init (--aws-profile P | --preview PORT)`:
 *   writes the private service.json and bridge.json under the state folder
 *   (default ~/.durtal/ebook-upload) for this database and the inspector
 *   built at this checkout. Run again after a new build-inspector to move the
 *   service to the new image; the volume, port and bridge stay.
 * - `pnpm ebooks:upload-service start (--aws-profile P | --preview PORT)`:
 *   runs the service until SIGINT/SIGTERM. Exits non-zero when it fails, so
 *   its launchd agent restarts it (scripts/deploy/upload_agent.py); 78 when
 *   the AWS sign-in expired, after leaving that reason beside its socket for
 *   the app to show. The app needs EBOOK_UPLOAD_BRIDGE=<state
 *   folder>/bridge.json (docs/11_DEPLOYMENT.md).
 *
 *   pnpm ebooks:upload-service build-inspector
 *   pnpm ebooks:upload-service init [--image NAME@sha256:...] [--port N] [--docker PATH]
 *     [--docker-socket PATH] [--state-dir DIR] (--aws-profile P | --preview PORT) [--env-dir DIR]
 *   pnpm ebooks:upload-service start [--state-dir DIR] (--aws-profile P | --preview PORT) [--env-dir DIR]
 */
import { register } from "node:module";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { loadEnvironment } from "./environment";
import { clearUploadServiceStatus, writeUploadServiceStatus } from "@/lib/ebooks/upload/service-status";
import {
  createUploadServiceConfig,
  readPrivateConfig,
  uploadServiceConfigSchema,
  uploadServicePaths,
  withInspectorImage,
} from "@/lib/ebooks/upload/service-config";

// Next.js resolves "server-only" to an empty module on the server; this is the server, outside Next.js.
const serverOnlyHook = "data:text/javascript,export async function resolve(s,c,n){return s==='server-only'?{url:'data:text/javascript,',shortCircuit:true}:n(s,c)}";
register(serverOnlyHook);

const INSPECTOR_REPOSITORY = "durtal-ebook-inspector";
const SOURCE_LABEL = "io.durtal.ebook-inspector.source";
/** The supervisor's host mutex: a fixed loopback port, part of the volume binding */
const DEFAULT_PORT = 47615;
/** Its exit status when the AWS sign-in expired (EX_CONFIG): restarts fail until a person signs in again */
const SIGN_IN_EXIT = 78;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "state-dir": { type: "string", default: resolve(homedir(), ".durtal/ebook-upload") },
    image: { type: "string" },
    port: { type: "string" },
    docker: { type: "string" },
    "docker-socket": { type: "string" },
    preview: { type: "string" },
    "aws-profile": { type: "string" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
const command = positionals[0] ?? "start";
const paths = uploadServicePaths(resolve(values["state-dir"]!));
const log = (message: string) => console.log(`[upload-service ${new Date().toISOString()}] ${message}`);

/** Whether a failure, or what caused it, is the AWS sign-in having expired */
function signInNeeded(error: unknown): boolean {
  for (let at = error, depth = 0; at instanceof Error && depth < 5; at = at.cause, depth++)
    if (at.name === "AwsSignInNeeded") return true;
  return false;
}

/** Leave the reason where the app reads it, then exit so launchd tries again later */
async function exitForSignIn(): Promise<never> {
  await writeUploadServiceStatus(paths.socket, "aws_sign_in").catch(() => {});
  log("The AWS sign-in has expired: run aws sso login --profile durtal-personal, then the agent starts the service again");
  process.exit(SIGN_IN_EXIT);
}

/** Any other exit clears a sign-in note left earlier: whatever stops it now is not the sign-in */
async function exitWith(code: number): Promise<never> {
  await clearUploadServiceStatus(paths.socket).catch(() => {});
  process.exit(code);
}

function revision(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function dockerExecutable(): string {
  if (values.docker) return values.docker;
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(folder, "docker");
    if (folder && existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error("No docker on PATH: install Docker, or give --docker PATH");
}

function dockerSocket(): string {
  if (values["docker-socket"]) return values["docker-socket"];
  const fromHost = process.env.DOCKER_HOST?.startsWith("unix://") ? process.env.DOCKER_HOST.slice("unix://".length) : null;
  const candidates = [fromHost, resolve(homedir(), ".docker/run/docker.sock"), "/var/run/docker.sock"];
  const found = candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
  if (!found) throw new Error("No Docker socket found: start Docker, or give --docker-socket PATH");
  return found;
}

/** The image built at this checkout, pinned by digest, and the revision it was built from. */
function pinnedImage(docker: string): { image: string; sourceRevision: string } {
  const reference = values.image ?? `${INSPECTOR_REPOSITORY}:${revision().slice(0, 12)}`;
  const inspect = (format: string) => execFileSync(docker, ["image", "inspect", "--format", format, reference], { encoding: "utf8" }).trim();
  let digests: string[];
  try {
    digests = JSON.parse(inspect("{{json .RepoDigests}}")) ?? [];
  } catch {
    throw new Error(`No inspector image ${reference}: run pnpm ebooks:upload-service build-inspector first`);
  }
  const image = values.image?.includes("@sha256:") ? values.image : digests.find((digest) => /@sha256:[a-f0-9]{64}$/.test(digest));
  if (!image)
    throw new Error(`${reference} has no content digest. Turn on Docker's containerd image store (Docker Desktop: Settings, General, "Use containerd for pulling and storing images"), then build again`);
  const sourceRevision = inspect(`{{index .Config.Labels "${SOURCE_LABEL}"}}`);
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error(`${reference} was not built by build-inspector (no ${SOURCE_LABEL} label)`);
  return { image, sourceRevision };
}

async function privateFolder(folder: string) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await chmod(folder, 0o700);
}

async function buildInspector() {
  const docker = dockerExecutable();
  const source = revision();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "infra/ebooks", "src/lib/ebooks", "package.json", "pnpm-lock.yaml"], { encoding: "utf8" }).trim();
  if (dirty) throw new Error("The inspector's sources have uncommitted changes: commit or discard them, so the image matches its revision");
  const tag = `${INSPECTOR_REPOSITORY}:${source.slice(0, 12)}`;
  log(`Building ${tag} from ${source}`);
  execFileSync(docker, ["build", "--file", "infra/ebooks/inspector/Dockerfile.inspector", "--label", `${SOURCE_LABEL}=${source}`, "--tag", tag, "."], { stdio: "inherit" });
  log(`Built ${pinnedImage(docker).image}`);
}

async function init() {
  const { url } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]!, awsProfile: values["aws-profile"] });
  const { uploadTargetFingerprint } = await import("@/lib/ebooks/upload-core/receipts");
  const targetFingerprint = uploadTargetFingerprint(url);
  const docker = dockerExecutable();
  const { image, sourceRevision } = pinnedImage(docker);
  if (existsSync(paths.service)) {
    const current = await readPrivateConfig(paths.service, uploadServiceConfigSchema);
    if (current.bridge.targetFingerprint !== targetFingerprint)
      throw new Error(`${paths.service} belongs to another database. Use another --state-dir for this one`);
    if (current.runtime.image === image) {
      log(`The upload service already uses ${image}`);
      return;
    }
    await writeFile(paths.service, `${JSON.stringify(withInspectorImage(current, image, sourceRevision), null, 2)}\n`, { mode: 0o600 });
    log(`Moved the upload service to ${image}; restart it to use the new inspector`);
    return;
  }
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (uid === undefined || gid === undefined) throw new Error("The upload service needs a POSIX host (macOS or Linux)");
  const port = Number(values.port ?? DEFAULT_PORT);
  const { service, bridge } = createUploadServiceConfig({
    stateDirectory: paths.state, volumeId: randomUUID(), hostId: randomUUID(), ownershipPort: port,
    secret: randomBytes(32).toString("hex"), targetFingerprint, dockerExecutable: docker, dockerSocket: dockerSocket(),
    image, sourceRevision, uid, gid,
  });
  for (const folder of [paths.state, paths.spool, paths.run, paths.docker]) await privateFolder(folder);
  // wx: never overwrite; the volume's identity is permanent once the service has run
  await writeFile(paths.bridge, `${JSON.stringify(bridge, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(paths.service, `${JSON.stringify(service, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  log(`Wrote ${paths.service} and ${paths.bridge}`);
  log(`Give the app EBOOK_UPLOAD_BRIDGE=${paths.bridge}, then start this service with the same environment flags`);
}

async function start() {
  const config = await readPrivateConfig(paths.service, uploadServiceConfigSchema);
  const { url } = await loadEnvironment({ preview: values.preview, envDir: values["env-dir"]!, awsProfile: values["aws-profile"] });
  const { uploadTargetFingerprint } = await import("@/lib/ebooks/upload-core/receipts");
  if (uploadTargetFingerprint(url) !== config.bridge.targetFingerprint)
    throw new Error(`${paths.service} belongs to another database than this environment's`);
  const { composeActualUploadService } = await import("@/lib/ebooks/upload-core/owned-service");
  let failed = false, expired = false;
  const service = await composeActualUploadService(config, (error) => {
    failed = true;
    expired ||= signInNeeded(error);
    log(`Failure: ${error instanceof Error ? error.message : String(error)}`);
  }, (error) => {
    const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
    log(`One upload failed; the service carries on: ${error.failure.reason} (${cause})`);
  });
  let stopping: Promise<void> | null = null;
  const stop = (reason: string, code: number) => {
    stopping ??= service.stop(reason).then(
      async () => { log(`Stopped (${reason})`); if (expired) await exitForSignIn(); await exitWith(code); },
      async (error: unknown) => {
        log(`Stop did not settle; ownership stays held until the process exits: ${error instanceof Error ? error.message : String(error)}`);
        if (expired) await exitForSignIn();
        await exitWith(1);
      },
    );
  };
  process.once("SIGINT", () => stop("shutdown", 0));
  process.once("SIGTERM", () => stop("shutdown", 0));
  log(`Starting: volume ${config.volumeId}, inspector ${config.runtime.image}`);
  await service.start();
  await clearUploadServiceStatus(paths.socket);
  log(`Ready on ${config.bridge.socketPath}`);
  // A failure inside the running service stops it; exit so the supervisor loop restarts it
  const watch = setInterval(() => { if (failed) { clearInterval(watch); stop("upload_service_failure", 1); } }, 1000);
}

try {
  if (command === "build-inspector") await buildInspector();
  else if (command === "init") await init();
  else if (command === "start") await start();
  else throw new Error(`Unknown command ${command}: use build-inspector, init or start`);
} catch (error) {
  console.error(`[upload-service ${new Date().toISOString()}] Error: ${error instanceof Error ? error.message : String(error)}`);
  if (command === "start" && signInNeeded(error)) await exitForSignIn();
  if (command === "start") await exitWith(1);
  process.exit(1);
}
