import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { inspectorCreateArguments, inspectorName, requestPath, sourcePath, INSPECTOR_PROTOCOL } from "@/lib/ebooks/upload/runtime-contract";
import { encodeInspectorRequest } from "@/lib/ebooks/upload/worker-request";

// The built inspector image, run with the upload service's own create
// arguments: no network, read-only, 16 processes, 768 MB. Only where an image
// is named, as `pnpm ebooks:upload-service build-inspector` pins it:
//   DURTAL_INSPECTOR_IMAGE=durtal/inspector@sha256:... pnpm vitest run upload-inspector-image
// The spool sits under the home folder, which Colima and Docker Desktop share.
const image = process.env.DURTAL_INSPECTOR_IMAGE;
const run = promisify(execFile);
const FIXTURES = "src/__tests__/fixtures/ebooks";

describe.skipIf(!image)("the built inspector image", () => {
  it.each(["epub2.epub", "text.pdf", "cbz.cbz"])("checks %s inside the service's sandbox", async (name) => {
    // Run as the user the service runs as: the worker checks its files are its own
    if (process.getuid!() === 0) throw new Error("Run the inspector image test as the upload service's user, not root");
    const spool = await mkdtemp(join(homedir(), ".durtal-inspector-test-"));
    const identity = { volumeId: randomUUID(), bindingSha256: "b".repeat(64),
      fence: { operationId: randomUUID(), ownerToken: randomUUID(), ownerFence: 1, generation: 1 } };
    // Docker runs from PATH; the config's executable and socket are only validated here
    const config = { dockerExecutable: "/usr/bin/docker", dockerSocket: "/var/run/docker.sock", dockerConfigDirectory: spool,
      image: image!, spoolRoot: spool, uid: process.getuid!(), gid: process.getgid!() };
    try {
      const bytes = await readFile(join(FIXTURES, name));
      const request = encodeInspectorRequest({ protocol: INSPECTOR_PROTOCOL, identity, name, bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex") });
      for (const [file, data] of [[sourcePath(config, identity), bytes], [requestPath(config, identity), request]] as const) {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file, data, { mode: 0o600 }); await chmod(file, 0o600);
      }
      await run("docker", inspectorCreateArguments(config, identity));
      const { stdout, stderr } = await run("docker", ["container", "start", "--attach", inspectorName(identity)], { maxBuffer: 64 * 1024 * 1024 });
      expect(stderr).toBe("");
      const frames = stdout.trim().split("\n").map((line) => JSON.parse(line) as { kind: string });
      expect(frames[0].kind).toBe("ready");
      expect(frames.at(-1)!.kind).toBe("report");
      const { stdout: exit } = await run("docker", ["container", "inspect", "--format", "{{.State.ExitCode}} {{.State.OOMKilled}}", inspectorName(identity)]);
      expect(exit.trim()).toBe("0 false");
    } finally {
      await run("docker", ["container", "rm", "--force", inspectorName(identity)]).catch(() => {});
      await rm(spool, { recursive: true, force: true });
    }
  }, 120_000);
});
