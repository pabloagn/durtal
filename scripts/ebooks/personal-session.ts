import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { ebookStorage, initializeEbookCli } from "../../src/lib/ebooks/storage";

const PROFILE = "durtal-personal";
const REGION = "eu-north-1";
const exec = promisify(execFile);
export function personalAwsEnvironment(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("AWS_")));
  return {
    ...env,
    NODE_ENV: process.env.NODE_ENV,
    AWS_CONFIG_FILE: join(homedir(), ".aws/config"),
    AWS_SHARED_CREDENTIALS_FILE: join(homedir(), ".aws/credentials"),
    AWS_EC2_METADATA_DISABLED: "true",
  };
}
export type AwsRunner = (args: string[]) => Promise<string>;
async function runAws(args: string[]): Promise<string> {
  try {
    const result = await exec("aws", [...args, "--profile", PROFILE, "--region", REGION, "--no-cli-pager"], { env: personalAwsEnvironment(), maxBuffer: 1024 * 1024 });
    return result.stdout;
  } catch {
    throw new Error("The durtal-personal session is unavailable; sign in with that profile. Credential output is withheld.");
  }
}

/** Explicit personal login, refreshed in memory. Never use the SDK's ambient/default chain. */
export async function initializePersonalSession(profile: string, run: AwsRunner = runAws, expectedAccount = process.env.EBOOKS_AWS_ACCOUNT_ID) {
  if (profile !== PROFILE) throw new Error("eBook commands accept only --aws-profile durtal-personal");
  if (!expectedAccount || !/^\d{12}$/.test(expectedAccount)) throw new Error("Set EBOOKS_AWS_ACCOUNT_ID to the reviewed personal account ID");
  const storage = ebookStorage();
  if (storage.bucket !== "durtal" || storage.region !== REGION) throw new Error("Personal eBook commands require durtal in eu-north-1");
  const readIdentity = async () => {
    const identity = JSON.parse(await run(["sts", "get-caller-identity", "--output", "json"])) as { Account?: string; Arn?: string };
    if (identity.Account !== expectedAccount || !identity.Arn?.match(new RegExp(`^arn:aws:(iam|sts)::${expectedAccount}:`)))
      throw new Error("Personal AWS account guard failed. Nothing written.");
    return identity.Arn.replace(/:assumed-role\/([^/]+)\/.+$/, ":role/$1");
  };
  const principal = await readIdentity();
  let cached:
    | {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken: string;
        expiration: Date;
        accountId: string;
      }
    | undefined;
  const credentials = async () => {
    if (cached && cached.expiration.getTime() > Date.now() + 300_000) return cached;
    if ((await readIdentity()) !== principal) throw new Error("The durtal-personal principal changed; create a new plan");
    let exported: {
      AccessKeyId?: string;
      SecretAccessKey?: string;
      SessionToken?: string;
      Expiration?: string;
    };
    try {
      exported = JSON.parse(await run(["configure", "export-credentials", "--format", "process"]));
    } catch {
      throw new Error("The durtal-personal session could not refresh. Credential output is withheld.");
    }
    if ((await readIdentity()) !== principal) throw new Error("The durtal-personal principal changed; create a new plan");
    const expiration = new Date(exported.Expiration ?? "");
    if (!exported.AccessKeyId || !exported.SecretAccessKey || !exported.SessionToken || !Number.isFinite(expiration.getTime()) || expiration.getTime() <= Date.now())
      throw new Error("A current temporary durtal-personal session is required");
    cached = {
      accessKeyId: exported.AccessKeyId,
      secretAccessKey: exported.SecretAccessKey,
      sessionToken: exported.SessionToken,
      expiration,
      accountId: expectedAccount,
    };
    return cached;
  };
  await credentials();
  const client = new S3Client({
    region: REGION,
    credentials,
    endpoint: `https://s3.${REGION}.amazonaws.com`,
  });
  initializeEbookCli(client, `${PROFILE}:${expectedAccount}:${principal}`, expectedAccount);
  return client;
}
