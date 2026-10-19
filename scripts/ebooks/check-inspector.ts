// Runs a built inspector image with the upload service's own create arguments
// (no network, read-only, 16 processes, 768 MB) on an EPUB, a PDF and a comic,
// and says whether each gives a report. Run it as the service's user after
// `pnpm ebooks:upload-service build-inspector`:
//   pnpm ebooks:check-inspector durtal/inspector@sha256:...
// The spool sits under the home folder, which Colima and Docker Desktop share.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { inspectorCreateArguments, inspectorName, requestPath, sourcePath, INSPECTOR_PROTOCOL } from "@/lib/ebooks/upload/runtime-contract";
import { encodeInspectorRequest } from "@/lib/ebooks/upload/worker-request";

const run = promisify(execFile);
const FIXTURES = "src/__tests__/fixtures/ebooks";
const image = process.argv[2];
if (!image) throw new Error("Usage: pnpm ebooks:check-inspector <image@sha256:...>");
// The worker checks its files are its own
if (process.getuid!() === 0) throw new Error("Run this as the upload service's user, not root");

async function check(name: string): Promise<void> {
  const spool = await mkdtemp(join(homedir(), ".durtal-inspector-check-"));
  const identity = { volumeId: randomUUID(), bindingSha256: "b".repeat(64),
    fence: { operationId: randomUUID(), ownerToken: randomUUID(), ownerFence: 1, generation: 1 } };
  // Docker runs from PATH; the executable and socket here are only validated
  const config = { dockerExecutable: "/usr/bin/docker", dockerSocket: "/var/run/docker.sock", dockerConfigDirectory: spool,
    image, spoolRoot: spool, uid: process.getuid!(), gid: process.getgid!() };
  try {
    const bytes = await readFile(join(FIXTURES, name));
    const request = encodeInspectorRequest({ protocol: INSPECTOR_PROTOCOL, identity, name, bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
    for (const [file, data] of [[sourcePath(config, identity), bytes], [requestPath(config, identity), request]] as const) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, data, { mode: 0o600 }); await chmod(file, 0o600);
    }
    await run("docker", inspectorCreateArguments(config, identity));
    const { stdout, stderr } = await run("docker", ["container", "start", "--attach", inspectorName(identity)], { maxBuffer: 64 * 1024 * 1024 })
      .catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? String(error) }));
    const { stdout: exit } = await run("docker", ["container", "inspect", "--format", "{{.State.ExitCode}} {{.State.OOMKilled}}", inspectorName(identity)]);
    const kinds = stdout.trim().split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { kind: string }).kind);
    if (exit.trim() !== "0 false" || stderr || kinds[0] !== "ready" || kinds.at(-1) !== "report")
      throw new Error(`${name}: exit ${exit.trim()}, frames ${kinds.join(" ") || "none"}${stderr ? `, stderr: ${stderr.trim().slice(0, 512)}` : ""}`);
    console.log(`ok      ${name}`);
  } finally {
    await run("docker", ["container", "rm", "--force", inspectorName(identity)]).catch(() => {});
    await rm(spool, { recursive: true, force: true });
  }
}

let failed = false;
for (const name of ["epub2.epub", "text.pdf", "cbz.cbz"])
  await check(name).catch((error: unknown) => { failed = true; console.log(`FAILED  ${error instanceof Error ? error.message : String(error)}`); });
process.exitCode = failed ? 1 : 0;
