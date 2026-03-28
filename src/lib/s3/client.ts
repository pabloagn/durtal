import { S3Client } from "@aws-sdk/client-s3";

const globalForS3 = globalThis as unknown as { s3Client: S3Client };

export const s3 =
  globalForS3.s3Client ??
  new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

if (process.env.NODE_ENV !== "production") globalForS3.s3Client = s3;

export const S3_BUCKET = process.env.S3_BUCKET ?? "durtal";
