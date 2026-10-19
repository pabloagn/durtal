import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:net";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UploadHostClient } from "@/lib/ebooks/upload/host-bridge";
import { uploadErrorResponse } from "@/lib/api/ebook-upload";
import {
  clearUploadServiceStatus, downReasonOf, readUploadServiceStatus, UPLOAD_CHECKS_FAILING_MESSAGE, UPLOAD_SIGN_IN_MESSAGE, uploadServiceStatusPath, writeUploadServiceStatus,
} from "@/lib/ebooks/upload/service-status";
import { UploadChecksFailing } from "@/lib/ebooks/upload/job-failure";

// An upload service that stopped because its AWS sign-in expired says so,
// instead of "not running" (SLN-1326)
let run: string, socketPath: string, server: Server | null = null;
const client = () => new UploadHostClient({ socketPath, secret: "a".repeat(64), targetFingerprint: "b".repeat(64), bindingSha256: "c".repeat(64) });
beforeEach(async () => {
  run = await realpath(await mkdtemp(path.join(tmpdir(), "upload-run-")));
  await chmod(run, 0o700);
  socketPath = path.join(run, "bridge.sock");
});
afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  server = null;
  await rm(run, { recursive: true, force: true });
});

describe("the upload service's sign-in note", () => {
  it("turns a down service into the sign-in message for the routes and the page", async () => {
    await writeUploadServiceStatus(socketPath, "aws_sign_in");
    const refused = await client().ready().then(() => null, (error: unknown) => error);
    expect(refused).toMatchObject({ status: 503, code: "upload_sign_in_needed", message: UPLOAD_SIGN_IN_MESSAGE });
    const response = uploadErrorResponse(refused);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "upload_sign_in_needed", error: "Uploads need the Mac to sign in to AWS again." });
    expect(await client().notice()).toBe(UPLOAD_SIGN_IN_MESSAGE);
  });

  it("still says not running when the service left no note, or one others could write", async () => {
    await expect(client().ready()).rejects.toMatchObject({ status: 503, code: "upload_unavailable" });
    expect(await client().notice()).toMatch(/not running/);
    await writeFile(uploadServiceStatusPath(socketPath), JSON.stringify({ version: 1, reason: "aws_sign_in", at: "now" }), { mode: 0o644 });
    await chmod(uploadServiceStatusPath(socketPath), 0o644);
    expect(await readUploadServiceStatus(socketPath)).toBeNull();
    await expect(client().ready()).rejects.toMatchObject({ code: "upload_unavailable" });
  });

  it("says nothing up front while the service's socket is there", async () => {
    await writeUploadServiceStatus(socketPath, "aws_sign_in");
    server = createServer();
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    await chmod(socketPath, 0o600);
    expect(await client().notice()).toBeNull();
  });

  it("writes the note privately and in one step, and clears it once the service is ready", async () => {
    await writeUploadServiceStatus(socketPath, "aws_sign_in");
    expect(await readdir(run)).toEqual(["status.json"]);
    expect(await readUploadServiceStatus(socketPath)).toBe("aws_sign_in");
    await clearUploadServiceStatus(socketPath);
    await clearUploadServiceStatus(socketPath);
    expect(await readUploadServiceStatus(socketPath)).toBeNull();
  });

  it("drops the note when a later start fails for another reason", async () => {
    // Signed in again, but this start fails before it is ready: here, no service.json
    const state = path.join(run, "state");
    await mkdir(path.join(state, "run"), { recursive: true, mode: 0o700 });
    const stateSocket = path.join(state, "run", "bridge.sock");
    await writeUploadServiceStatus(stateSocket, "aws_sign_in");
    const exit = await new Promise<number | null>((resolve) => {
      execFile(process.execPath, ["--import", "tsx", "scripts/ebooks/upload-service.ts", "start", "--state-dir", state],
        { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production" } }, (error) => resolve(error ? (error.code as number) : 0));
    });
    expect(exit).toBe(1);
    expect(await readUploadServiceStatus(stateSocket)).toBeNull();
    expect(await readdir(path.join(state, "run"))).toEqual([]);
  }, 30_000);
});

// Three file checks failed in a row (SLN-1467): the service stops and stays
// stopped, and the app says why instead of "not running"
describe("the upload service's failing-checks note", () => {
  it("names the failure that stopped the service, through its causes", () => {
    const checks = new UploadChecksFailing({ cause: new Error("inspector exited 125") });
    expect(downReasonOf(checks)).toBe("checks_failing");
    expect(downReasonOf(new Error("stopped", { cause: checks }))).toBe("checks_failing");
    const signIn = Object.assign(new Error("expired"), { name: "AwsSignInNeeded" });
    expect(downReasonOf(new Error("refresh failed", { cause: signIn }))).toBe("aws_sign_in");
    expect(downReasonOf(new Error("Docker hiccup"))).toBeNull();
    expect(downReasonOf("not an error")).toBeNull();
  });

  it("turns a down service into the failing-checks message for the routes and the page", async () => {
    await writeUploadServiceStatus(socketPath, "checks_failing");
    expect(await readUploadServiceStatus(socketPath)).toBe("checks_failing");
    const refused = await client().ready().then(() => null, (error: unknown) => error);
    expect(refused).toMatchObject({ status: 503, code: "upload_checks_failing", message: UPLOAD_CHECKS_FAILING_MESSAGE });
    const response = uploadErrorResponse(refused);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "upload_checks_failing", error: UPLOAD_CHECKS_FAILING_MESSAGE });
    expect(await client().notice()).toBe(UPLOAD_CHECKS_FAILING_MESSAGE);
    await clearUploadServiceStatus(socketPath);
    expect(await client().notice()).toMatch(/not running/);
  });
});
