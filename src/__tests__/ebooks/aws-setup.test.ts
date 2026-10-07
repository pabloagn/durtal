import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/*
 * SLN-491: the AWS setup for the e-book bucket. The documents carry no
 * account or secret; plan only reads; apply refuses without Joris's yes and,
 * against a fake AWS CLI, creates exactly the pieces and keeps the private
 * key out of its output.
 */

const root = path.resolve(__dirname, "../../..");
const docs = path.join(root, "infra/aws/ebooks");
const script = path.join(root, "scripts/aws/ebooks-storage.sh");
const PLACEHOLDERS = ["BUCKET", "PREFIX", "REGION", "ADMIN_ARN", "DISTRIBUTION_ARN", "OAC_ID", "CACHE_POLICY_ID", "RESPONSE_HEADERS_POLICY_ID", "KEY_GROUP_ID", "ALERT_EMAIL"];

/** A fake `aws`: logs each call (with the files it is given) and answers as a new, empty account would */
const FAKE_AWS = String.raw`#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
files = {a: open(a[7:]).read() for a in args if a.startswith("file://")}
with open(os.environ["FAKE_AWS_LOG"], "a") as log:
    log.write(json.dumps({"args": args, "files": files}) + "\n")
call = " ".join(args[:2])
answers = {
    "--version": "aws-cli/2.17.0 Python/3.12.6 Darwin/24.0.0",
    "sts get-caller-identity": json.dumps({"Account": "123456789012", "Arn": "arn:aws:iam::123456789012:user/admin"}),
    "cloudfront create-origin-access-control": "OAC1",
    "cloudfront create-public-key": "K2JCJMDEHXQW5F",
    "cloudfront create-key-group": "KG1",
    "cloudfront create-cache-policy": "CP1",
    "cloudfront create-response-headers-policy": "RH1",
    "cloudfront create-distribution": "D1",
    "cloudfront get-distribution": "d111111abcdef8.cloudfront.net",
}
if call in answers or args[:1] == ["--version"]:
    print(answers.get(call, answers["--version"]))
elif args[0] in ("s3api", "iam", "budgets") and args[1].startswith(("put-", "create-", "update-")):
    pass
elif call == "cloudfront list-distributions":
    print("None")
else:
    sys.stderr.write("An error occurred (NotFound)\n")
    sys.exit(254)
`;

let dir: string;
let log: string;
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: `${dir}/bin:/usr/bin:/bin`, HOME: dir, FAKE_AWS_LOG: log, ...env },
  });
const calls = () =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; files: Record<string, string> });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "durtal-aws-"));
  log = path.join(dir, "aws.jsonl");
  writeFileSync(log, "");
  spawnSync("mkdir", ["-p", `${dir}/bin`]);
  writeFileSync(`${dir}/bin/aws`, FAKE_AWS);
  chmodSync(`${dir}/bin/aws`, 0o755);
  // python3 and openssl, wherever they are, beside the fake aws
  for (const tool of ["python3", "openssl"]) {
    const found = spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();
    if (found) spawnSync("ln", ["-s", found, `${dir}/bin/${tool}`]);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("infra/aws/ebooks", () => {
  it("is valid JSON with no account id, ARN of a real account or secret, and only known placeholders", () => {
    for (const name of readdirSync(docs)) {
      const text = readFileSync(path.join(docs, name), "utf8");
      expect(() => JSON.parse(text), name).not.toThrow();
      expect(text, name).not.toMatch(/\d{12}/);
      expect(text, name).not.toMatch(/PRIVATE KEY|AKIA[0-9A-Z]{16}/);
      for (const [, placeholder] of text.matchAll(/__([A-Z_]+)__/g)) expect(PLACEHOLDERS, `${name}: __${placeholder}__`).toContain(placeholder);
    }
  });

  it("keeps book files from being deleted by anyone but the admin, and lets the app delete only staging/", () => {
    const policy = JSON.parse(readFileSync(path.join(docs, "bucket-policy.json"), "utf8"));
    const deny = policy.Statement.find((s: { Sid: string }) => s.Sid === "NoBookFileIsDeleted");
    expect(deny).toMatchObject({ Effect: "Deny", Action: "s3:DeleteObject", Resource: "arn:aws:s3:::__BUCKET__/__PREFIX__files/*" });
    const app = JSON.parse(readFileSync(path.join(docs, "app-user-policy.json"), "utf8"));
    const deletes = app.Statement.filter((s: { Action: string | string[] }) => [s.Action].flat().includes("s3:DeleteObject"));
    expect(deletes.map((s: { Resource: string }) => s.Resource)).toEqual(["arn:aws:s3:::__BUCKET__/__PREFIX__staging/*"]);
  });
});

describe("scripts/aws/ebooks-storage.sh", () => {
  it("refuses apply without --yes-from-joris, before any AWS call", () => {
    const result = run(["apply", "--app-user", "durtal", "--alert-email", "a@example.com"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--yes-from-joris/);
    expect(calls()).toEqual([]);
  });

  it("says the AWS CLI v2 is needed when there is none", () => {
    rmSync(`${dir}/bin/aws`);
    const result = run(["plan"]);
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/AWS CLI v2 is needed/);
  });

  it("plans with read-only calls only, and lists everything as missing in an empty account", () => {
    const result = run(["plan", "--app-user", "durtal"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/bucket +missing: apply creates it/);
    expect(result.stdout).toMatch(/distribution +missing: apply creates it/);
    expect(result.stdout).toMatch(/budget alarm \(5 USD a month\) +missing/);
    expect(result.stdout).toMatch(/to create or update\. apply does exactly this/);
    for (const { args } of calls()) {
      const verb = args[0] === "--version" ? "version" : args[1];
      expect(verb, args.join(" ")).toMatch(/^(version|get-|list-|describe-|head-)/);
    }
  });

  it("applies in an empty account: every piece once, the key only in the env file", () => {
    const envFile = path.join(dir, ".env.local");
    writeFileSync(envFile, "DATABASE_URL=postgresql://x\nEBOOK_CDN_PRIVATE_KEY=\n");
    const result = run(["apply", "--yes-from-joris", "--app-user", "durtal", "--alert-email", "a@example.com", "--env-file", envFile]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const made = calls().map((c) => c.args.slice(0, 2).join(" ")).filter((c) => /(create|put|update)-/.test(c));
    expect(made).toEqual([
      "s3api create-bucket",
      "s3api put-public-access-block",
      "s3api put-bucket-ownership-controls",
      "s3api put-bucket-encryption",
      "s3api put-bucket-versioning",
      "s3api put-bucket-lifecycle-configuration",
      "cloudfront create-origin-access-control",
      "cloudfront create-public-key",
      "cloudfront create-key-group",
      "cloudfront create-cache-policy",
      "cloudfront create-response-headers-policy",
      "cloudfront create-distribution",
      "s3api put-bucket-policy",
      "iam put-user-policy",
      "budgets create-budget",
    ]);
    const policy = calls().find((c) => c.args[1] === "put-bucket-policy")!;
    const document = JSON.parse(policy.args[policy.args.indexOf("--policy") + 1].startsWith("file://") ? Object.values(policy.files)[0] : "{}");
    expect(JSON.stringify(document)).toContain("arn:aws:cloudfront::123456789012:distribution/D1");
    expect(JSON.stringify(document)).toContain("arn:aws:iam::123456789012:user/admin");
    // The private key: one base64 line in the env file, never on screen
    const env = readFileSync(envFile, "utf8");
    expect(env.match(/^EBOOK_CDN_PRIVATE_KEY=/gm)).toHaveLength(1);
    const key = /^EBOOK_CDN_PRIVATE_KEY=(.+)$/m.exec(env)![1];
    expect(Buffer.from(key, "base64").toString()).toMatch(/^-----BEGIN (RSA )?PRIVATE KEY-----/);
    expect(env).toContain("DATABASE_URL=postgresql://x\n");
    expect(result.stdout).not.toContain(key.slice(0, 40));
    expect(result.stdout).not.toMatch(/PRIVATE KEY-----/);
    expect(result.stdout).toContain("EBOOK_CDN_URL=https://d111111abcdef8.cloudfront.net");
    expect(result.stdout).toContain("EBOOK_CDN_KEY_PAIR_ID=K2JCJMDEHXQW5F");
  });
});
