import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createUploadServiceConfig,
  readPrivateConfig,
  uploadBridgeConfigSchema,
  uploadServiceConfigSchema,
  withInspectorImage,
  type UploadServiceInput,
} from "@/lib/ebooks/upload/service-config";
import { supervisorBindingSha256 } from "@/lib/ebooks/upload/runtime-contract";

const digest = (n: string) => `durtal-ebook-inspector@sha256:${n.repeat(64)}`;
const input = (overrides: Partial<UploadServiceInput> = {}): UploadServiceInput => ({
  stateDirectory: "/Users/joris/.durtal/ebook-upload",
  volumeId: "11111111-1111-4111-8111-111111111111",
  hostId: "22222222-2222-4222-8222-222222222222",
  ownershipPort: 47615,
  secret: "a".repeat(64),
  targetFingerprint: "b".repeat(64),
  dockerExecutable: "/usr/local/bin/docker",
  dockerSocket: "/Users/joris/.docker/run/docker.sock",
  image: digest("c"),
  sourceRevision: "d".repeat(40),
  uid: 501,
  gid: 20,
  ...overrides,
});

describe("the upload service configuration (SLN-506)", () => {
  it("binds the app's bridge to the service it reaches", () => {
    const { service, bridge } = createUploadServiceConfig(input());
    expect(service.bridge).toEqual(bridge);
    expect(bridge).toEqual({
      socketPath: "/Users/joris/.durtal/ebook-upload/run/bridge.sock",
      secret: "a".repeat(64),
      targetFingerprint: "b".repeat(64),
      bindingSha256: supervisorBindingSha256({ volumeId: service.volumeId, hostId: service.hostId, ownershipPort: 47615, runtime: service.runtime }),
    });
    expect(service.runtime).toMatchObject({
      spoolRoot: "/Users/joris/.durtal/ebook-upload/spool",
      dockerConfigDirectory: "/Users/joris/.durtal/ebook-upload/docker",
      uid: 501,
      gid: 20,
    });
    expect(service.build).toMatchObject({ image: digest("c"), sourceRevision: "d".repeat(40), protocol: 1, boundedOutput: true });
  });

  it("refuses an image not pinned by digest, root, and a relative state folder", () => {
    expect(() => createUploadServiceConfig(input({ image: "durtal-ebook-inspector:latest" }))).toThrow("pinned by digest");
    expect(() => createUploadServiceConfig(input({ uid: 0 }))).toThrow();
    expect(() => createUploadServiceConfig(input({ stateDirectory: "state" }))).toThrow("absolute");
  });

  it("moves to a new inspector image without changing the volume binding", () => {
    const { service } = createUploadServiceConfig(input());
    const moved = withInspectorImage(service, digest("e"), "f".repeat(40));
    expect(moved.runtime.image).toBe(digest("e"));
    expect(moved.build).toMatchObject({ image: digest("e"), sourceRevision: "f".repeat(40) });
    expect(moved.bridge).toEqual(service.bridge);
    expect(() => withInspectorImage(service, "durtal-ebook-inspector:new", "f".repeat(40))).toThrow();
  });
});

describe("readPrivateConfig", () => {
  let folder: string;
  beforeEach(async () => {
    folder = path.join(await mkdtemp(path.join(tmpdir(), "durtal-upload-config-")), "state");
    await mkdir(folder, { mode: 0o700 });
  });
  afterEach(async () => {
    await rm(path.dirname(folder), { recursive: true, force: true });
  });
  const bridge = { socketPath: "/private/run/bridge.sock", secret: "a".repeat(64), targetFingerprint: "b".repeat(64), bindingSha256: "c".repeat(64) };

  it("reads a private file in a private folder", async () => {
    const file = path.join(folder, "bridge.json");
    await writeFile(file, JSON.stringify(bridge), { mode: 0o600 });
    expect(await readPrivateConfig(file, uploadBridgeConfigSchema)).toEqual(bridge);
  });

  it("refuses a file others can read, a shared folder, a symlink and extra keys", async () => {
    const file = path.join(folder, "bridge.json");
    await writeFile(file, JSON.stringify(bridge), { mode: 0o644 });
    await expect(readPrivateConfig(file, uploadBridgeConfigSchema)).rejects.toThrow("mode 0600");
    await chmod(file, 0o600);
    await chmod(folder, 0o755);
    await expect(readPrivateConfig(file, uploadBridgeConfigSchema)).rejects.toThrow("private to this user");
    await chmod(folder, 0o700);
    const link = path.join(folder, "link.json");
    await symlink(file, link);
    await expect(readPrivateConfig(link, uploadBridgeConfigSchema)).rejects.toThrow("symlink");
    await writeFile(file, JSON.stringify({ ...bridge, extra: 1 }), { mode: 0o600 });
    await expect(readPrivateConfig(file, uploadBridgeConfigSchema)).rejects.toThrow();
    await expect(readPrivateConfig(file, uploadServiceConfigSchema)).rejects.toThrow();
  });
});
