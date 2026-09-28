import { deleteUnusedObjects, ownedPrefixes } from "./cleanup";

/** Only this collection's namespaces are eligible. Never delete borrowed book/author artwork. */
export function cleanupCollectionArtwork(
  id: string,
  storedKeys: string[],
): Promise<boolean> {
  const prefixes = ownedPrefixes.collection(id);
  return deleteUnusedObjects(
    {
      prefixes,
      keys: storedKeys.filter((key) =>
        prefixes.some((prefix) => key.startsWith(prefix)),
      ),
    },
    `collection ${id}`,
  );
}
