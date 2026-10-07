import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

/*
 * An in-memory bucket in place of `@/lib/s3/client`, for a database suite
 * whose actions end with the S3 clean-up (a merge or a delete): the clean-up
 * runs against this map, and nothing leaves the machine (SLN-535). A command
 * the map does not answer throws.
 *
 *   vi.mock("@/lib/s3/client", async () => (await import("@/__tests__/helpers/memory-bucket")).memoryS3Client());
 */
export function memoryS3Client(objects = new Map<string, Buffer>()) {
  return {
    S3_BUCKET: "local-test",
    s3: {
      async send(command: unknown) {
        if (command instanceof PutObjectCommand) {
          objects.set(command.input.Key!, Buffer.from(command.input.Body as Uint8Array));
          return {};
        }
        if (command instanceof GetObjectCommand) {
          const body = objects.get(command.input.Key!);
          if (!body) throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" });
          return { Body: { transformToByteArray: async () => new Uint8Array(body) }, ContentLength: body.length };
        }
        if (command instanceof ListObjectsV2Command) {
          const prefix = command.input.Prefix ?? "";
          return { Contents: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((Key) => ({ Key })), IsTruncated: false };
        }
        if (command instanceof DeleteObjectsCommand) {
          for (const { Key } of command.input.Delete?.Objects ?? []) objects.delete(Key!);
          return { Errors: [] };
        }
        if (command instanceof DeleteObjectCommand) {
          objects.delete(command.input.Key!);
          return {};
        }
        throw new Error("Unexpected S3 command in a test");
      },
    },
  };
}
