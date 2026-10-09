import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
const root = path.resolve(__dirname, "../../..");
const script = path.join(root, "scripts/aws/ebooks-storage.sh");
let dir: string;
let log: string;
const FAKE = String.raw`#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['FAKE_LOG'],'a') as f: f.write(json.dumps({'args':args,'ambient':{k:v for k,v in os.environ.items() if k.startswith('AWS_')},'files':{a: open(a[7:]).read() for a in args if a.startswith('file://')}}) +'\n')
call =' '.join(args[:2])
answers = {
 'sts get-caller-identity': json.dumps({'Account':os.environ.get('FAKE_ACCOUNT','111122223333'),'Arn':os.environ.get('FAKE_ARN','arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_AdministratorAccess_example1234567890/test')}),
 's3api get-bucket-location':'eu-north-1',
 's3api get-bucket-policy':json.dumps({'Policy':json.dumps({'Version':'2012-10-17','Statement':[{'Sid':'ExistingMedia','Effect':'Allow','Principal':'*','Action':'s3:GetObject','Resource':'arn:aws:s3:::durtal/gold/media/*'}]})}),
 's3api get-bucket-lifecycle-configuration':json.dumps({'Rules':[{'ID':'existing','Status':'Enabled','Filter':{'Prefix':'unrelated/'},'AbortIncompleteMultipartUpload':{'DaysAfterInitiation':30}}]}),
}
if os.environ.get('FAKE_DENIED') and call=='s3api get-bucket-policy': sys.stderr.write('AccessDenied');sys.exit(254)
if call in answers:
    print(answers[call])
elif call=='iam get-user-policy': sys.stderr.write('NoSuchEntity');sys.exit(254)
elif args[1].startswith('put-'):
    pass
else:
    sys.stderr.write('Unexpected fake call');sys.exit(254)
`;
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", [script, ...args,
      "--expected-account",
      "111122223333",
      "--admin-arn",
      "arn:aws:iam::111122223333:role/aws-reserved/sso.amazonaws.com/eu-north-1/AWSReservedSSO_AdministratorAccess_example1234567890",
    ], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: `${dir}/bin:/usr/bin:/bin`, HOME: dir,
        FAKE_LOG: log,
        AWS_PROFILE: "forbidden-work",
        AWS_ACCESS_KEY_ID: "ambient",
        AWS_ENDPOINT_URL: "https://forbidden.invalid", ...env,
      },
  },
  );
const calls = () =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s) as { args: string[]; ambient: Record<string, string>; files: Record<string, string> });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "durtal-scoped-aws-"));
  log = path.join(dir, "calls");
  writeFileSync(log, "");
  spawnSync("mkdir", ["-p", `${dir}/bin`]);
  writeFileSync(`${dir}/bin/aws`, FAKE);
  chmodSync(`${dir}/bin/aws`, 0o755);
  const python = spawnSync("bash", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
  spawnSync("ln", ["-s", python, `${dir}/bin/python3`]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("shared-bucket eBook infrastructure", () => {
  it("refuses unapproved apply before any AWS call", () => {
    expect(run(["apply"]).status).toBe(2);
      expect(calls()).toEqual([]);
  });

  it("requires AWS CLI", () => {
    rmSync(`${dir}/bin/aws`);
    expect(run(["plan"]).status).toBe(3);
  });
  it("checks personal account before accessing the bucket", () => {
    expect(run(["plan"], { FAKE_ACCOUNT: "123456789012" }).status).toBe(1);
    expect(calls()).toHaveLength(1);
  });
  it("refuses apply from a different administrator before bucket access", () => {
    expect(
      run(["apply", "--yes-from-joris"], {
        FAKE_ARN: "arn:aws:sts::111122223333:assumed-role/OtherAdmin/test",
      }).status,
    ).toBe(1);
    expect(calls()).toHaveLength(1);
  });
  it("fails closed on permission errors", () => {
    expect(run(["plan"], { FAKE_DENIED: "1" }).status).toBe(1);
    expect(calls().some((c) => c.args[1].startsWith("put-"))).toBe(false);
  });
  it("plans only explicit personal reads and preserves existing policy/rules", () => {
    const out = path.join(dir, "rendered");
    const result = run(["plan", "--output-dir", out]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const call of calls()) {
      expect(call.args[call.args.indexOf("--profile") + 1]).toBe("durtal-personal");
      expect(call.args[call.args.indexOf("--region") + 1]).toBe("eu-north-1");
      expect(call.args[1]).toMatch(/^(get-|list-|head-|describe-)/);
      expect(call.ambient).not.toHaveProperty("AWS_ACCESS_KEY_ID");
      expect(call.ambient).not.toHaveProperty("AWS_PROFILE");
      expect(call.ambient).not.toHaveProperty("AWS_ENDPOINT_URL");
    }
    const policy = JSON.parse(readFileSync(path.join(out, "bucket-policy.json"), "utf8"));
    expect(policy.Statement[0].Sid).toBe("ExistingMedia");
    const deny = policy.Statement.find((s: { Sid: string }) => s.Sid === "EbooksDenyDeletionExceptAdmin");
    expect(deny.Effect).toBe("Deny");
    expect(deny.Action).toContain("s3:DeleteObject");
    expect(deny.Condition.ArnNotEquals["aws:PrincipalArn"]).toBe(
      "arn:aws:iam::111122223333:role/aws-reserved/sso.amazonaws.com/eu-north-1/AWSReservedSSO_AdministratorAccess_example1234567890",
    );
    expect(deny.Resource).toContain("arn:aws:s3:::durtal/bronze/ebooks/*");
    expect(deny.Resource).not.toContain("arn:aws:s3:::durtal/*");
    const lifecycle = JSON.parse(readFileSync(path.join(out, "lifecycle.json"), "utf8"));
    expect(lifecycle.Rules[0].ID).toBe("existing");
    expect(lifecycle.Rules.slice(1).map((r: { Filter: { Prefix: string } }) => r.Filter.Prefix)).toEqual(["bronze/ebooks/", "silver/ebooks/", "gold/ebooks/"]);
    expect(JSON.stringify(lifecycle)).not.toMatch(/Expiration|Noncurrent|DeleteMarker/);
  });
  it("applies only merged eBook protection, lifecycle and multipart policy", () => {
    const result = run(["apply", "--yes-from-joris"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(
      calls()
        .filter((c) => c.args[1].startsWith("put-")).map((c) => c.args.slice(0, 2).join(" ")),
    ).toEqual(["s3api put-bucket-policy",
      "s3api put-bucket-lifecycle-configuration", "iam put-user-policy"]);
    expect(calls().some((c) => c.args.includes("DurtalS3Access") || c.args[0] === "cloudfront")).toBe(false);
  });
});
