import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "node:os";
import path from "node:path";
import { assertPersonalReadCommand, AwsSignInNeeded, initializePersonalSession, personalAwsEnvironment, signInExpired } from "../../../scripts/ebooks/personal-session";
const initialized = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ebooks/storage", () => ({
  ebookStorage: () => ({ bucket: "durtal", region: "eu-north-1" }),
  initializeEbookCli: initialized,
}));
const principal = "arn:aws:sts::111122223333:assumed-role/PersonalAdmin/session";
function runner() {
  let account = "111122223333",
    arn = principal;
  const run = vi.fn(async (args: string[]) =>
    args[0] === "sts"
      ? JSON.stringify({ Account: account, Arn: arn })
      : JSON.stringify({
          AccessKeyId: "temporary-key",
          SecretAccessKey: "withheld-secret",
          SessionToken: "temporary-token",
          Expiration: new Date(Date.now() + 3600_000).toISOString(),
        }),
  );
  return {
    run,
    change: (newAccount: string, newArn = principal) => {
      account = newAccount;
      arn = newArn;
    },
  };
}
beforeEach(() => {
  initialized.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("explicit personal AWS session", () => {
  it("requires an explicit reviewed account before any AWS call", async () => {
    vi.stubEnv("EBOOKS_AWS_ACCOUNT_ID", "");
    const fake = runner();
    await expect(initializePersonalSession("durtal-personal", fake.run)).rejects.toThrow(/EBOOKS_AWS_ACCOUNT_ID/);
    expect(fake.run).not.toHaveBeenCalled();
  });
  it("refuses other profiles and wrong accounts before exporting credentials", async () => {
    const fake = runner();
    await expect(initializePersonalSession("work", fake.run, "111122223333")).rejects.toThrow(/only/);
    expect(fake.run, "111122223333").not.toHaveBeenCalled();
    fake.change("123456789012");
    await expect(initializePersonalSession("durtal-personal", fake.run, "111122223333")).rejects.toThrow(/account guard/);
    expect(fake.run.mock.calls.every(([args]) => args[0] === "sts")).toBe(true);
    expect(initialized).not.toHaveBeenCalled();
  });
  it("refreshes temporary credentials and binds the same account and role across session names", async () => {
    const fake = runner();
    const client = await initializePersonalSession("durtal-personal", fake.run, "111122223333");
    expect(initialized).toHaveBeenCalledWith(client, "durtal-personal:111122223333:arn:aws:sts::111122223333:role/PersonalAdmin", "111122223333");
    expect((await client.config.credentials()).accessKeyId).toBe("temporary-key");
    expect(fake.run.mock.calls.filter(([args]) => args[0] === "configure")).toHaveLength(1);
    vi.setSystemTime(Date.now() + 3600_000);
    fake.change("111122223333", principal.replace("/session", "/renewed"));
    await client.config.credentials();
    expect(fake.run.mock.calls.filter(([args]) => args[0] === "configure")).toHaveLength(2);
    client.destroy();
  });
  it("refuses a changed account or role during refresh", async () => {
    for (const [account, arn] of [
      ["123456789012", principal],
      ["111122223333", principal.replace("PersonalAdmin", "OtherAdmin")],
    ]) {
      const fake = runner();
      const client = await initializePersonalSession("durtal-personal", fake.run, "111122223333");
      await client.config.credentials();
      vi.setSystemTime(Date.now() + 3600_000);
      fake.change(account, arn);
      await expect(client.config.credentials()).rejects.toThrow(/guard|principal changed/);
      client.destroy();
    }
  });
  it("withholds failed export output and never falls back to an ambient provider", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "sts") return JSON.stringify({ Account: "111122223333", Arn: principal });
      throw new Error("withheld-secret");
    });
    await expect(initializePersonalSession("durtal-personal", run, "111122223333")).rejects.toThrow("Credential output is withheld");
    expect(initialized).not.toHaveBeenCalled();
  });
  it("tells an expired sign-in from other failures, so the upload service can say so (SLN-1326)", async () => {
    for (const stderr of [
      "Error when retrieving token from sso: Token has expired and refresh failed",
      "The SSO session associated with this profile has expired or is otherwise invalid. To refresh this SSO session run aws sso login with the corresponding profile.",
      "An error occurred (ExpiredToken) when calling the GetCallerIdentity operation: The security token included in the request is expired",
    ]) expect(signInExpired(stderr)).toBe(true);
    for (const stderr of ["Could not connect to the endpoint URL", "aws: command not found", ""]) expect(signInExpired(stderr)).toBe(false);
    // An expired sign-in while refreshing stays that, not a generic refresh failure
    const fake = runner();
    const client = await initializePersonalSession("durtal-personal", fake.run, "111122223333");
    vi.setSystemTime(Date.now() + 3600_000);
    fake.run.mockImplementation(async (args: string[]) => {
      if (args[0] === "sts") return JSON.stringify({ Account: "111122223333", Arn: principal });
      throw new AwsSignInNeeded();
    });
    await expect(client.config.credentials()).rejects.toBeInstanceOf(AwsSignInNeeded);
    client.destroy();
    // So is an exported session that has already run out
    const stale = vi.fn(async (args: string[]) => args[0] === "sts"
      ? JSON.stringify({ Account: "111122223333", Arn: principal })
      : JSON.stringify({ AccessKeyId: "k", SecretAccessKey: "s", SessionToken: "t", Expiration: new Date(Date.now() - 1000).toISOString() }));
    await expect(initializePersonalSession("durtal-personal", stale, "111122223333")).rejects.toBeInstanceOf(AwsSignInNeeded);
  });
  it("discards ambient credentials, profiles and endpoint overrides", () => {
    for (const name of ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_ENDPOINT_URL", "AWS_CONFIG_FILE"]) vi.stubEnv(name, "forbidden");
    const env = personalAwsEnvironment();
    expect(env.AWS_PROFILE).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.AWS_ENDPOINT_URL).toBeUndefined();
    expect(env.AWS_CONFIG_FILE).toBe(path.join(homedir(), ".aws/config"));
    expect(env.AWS_EC2_METADATA_DISABLED).toBe("true");
  });
});

// These checks execute before execFile, independently of SDK protection.
it("allows only identity reads and credential export in the personal AWS CLI bridge", () => {
  expect(() => assertPersonalReadCommand(["sts", "get-caller-identity", "--output", "json"])).not.toThrow();
  expect(() => assertPersonalReadCommand(["configure", "export-credentials", "--format", "process"])).not.toThrow();
  expect(() => assertPersonalReadCommand(["s3api", "put-object", "--bucket", "durtal"])).toThrow("nothing sent");
  expect(() => assertPersonalReadCommand(["sts", "get-caller-identity", "--profile", "other", "--output", "json"])).toThrow("nothing sent");
});
