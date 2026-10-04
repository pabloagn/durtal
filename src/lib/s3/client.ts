import { S3Client } from "@aws-sdk/client-s3";
import { serverEnv } from "@/lib/env";

export { S3_BUCKET } from "@/lib/env";

const globalForS3 = globalThis as unknown as { s3Client: S3Client };

export const s3 =
  globalForS3.s3Client ??
  new S3Client({
    region: async () => serverEnv().AWS_REGION,
    credentials: async () => ({
      accessKeyId: serverEnv().AWS_ACCESS_KEY_ID,
      secretAccessKey: serverEnv().AWS_SECRET_ACCESS_KEY,
    }),
  });

if (process.env.NODE_ENV !== "production") globalForS3.s3Client = s3;
