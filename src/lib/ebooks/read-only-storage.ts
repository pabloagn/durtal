import type { S3Client } from "@aws-sdk/client-s3";
import { ebookS3 } from "./storage";

/** Planning and verification may dispatch only these S3 reads. */
const READ_COMMANDS = new Set([
  "ListObjectsV2Command",
  "HeadObjectCommand",
  "GetObjectCommand",
]);
const GUARD = "durtalEbookReadOnly";
const scopes = new WeakMap<S3Client, number>();

/**
 * Guard actual SDK dispatch, before serialization/signing/network access.
 * Nested callers share the guard; the last scope removes it for later apply.
 */
export async function withReadOnlyEbookStorage<T>(
  work: () => Promise<T>,
): Promise<T> {
  const client = ebookS3();
  const depth = scopes.get(client) ?? 0;
  if (!depth)
    client.middlewareStack.add(
      (next, context) => async (args) => {
        if (!READ_COMMANDS.has(context.commandName ?? ""))
          throw new Error(
            `Read-only eBook planning refused AWS ${context.commandName ?? "unknown command"}; nothing sent`,
          );
        return next(args);
      },
      { step: "initialize", priority: "high", name: GUARD },
    );
  scopes.set(client, depth + 1);
  try {
    return await work();
  } finally {
    const remaining = (scopes.get(client) ?? 1) - 1;
    if (remaining) scopes.set(client, remaining);
    else {
      scopes.delete(client);
      client.middlewareStack.remove(GUARD);
    }
  }
}
