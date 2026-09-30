import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "./client";
import { deleteUnreferencedS3Keys } from "./references";

/** Only this collection's namespaces are eligible. Never delete borrowed book/author artwork. */
export async function cleanupCollectionArtwork(
  id: string,
  storedKeys: string[],
): Promise<boolean> {
  const prefixes = [
    `gold/media/collection/${id}/`,
    `bronze/media/collection/${id}/`,
  ];
  try {
    const keys = new Set(
      storedKeys.filter((key) =>
        prefixes.some((prefix) => key.startsWith(prefix)),
      ),
    );
    for (const Prefix of prefixes) {
      let ContinuationToken: string | undefined;
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: S3_BUCKET,
            Prefix,
            ContinuationToken,
          }),
        );
        for (const item of page.Contents ?? [])
          if (item.Key?.startsWith(Prefix)) keys.add(item.Key);
        ContinuationToken = page.IsTruncated
          ? page.NextContinuationToken
          : undefined;
      } while (ContinuationToken);
    }
    if (!keys.size) return false;
    return !(await deleteUnreferencedS3Keys([...keys]));
  } catch {
    console.error("Collection artwork cleanup needs retry", id);
    return true;
  }
}
