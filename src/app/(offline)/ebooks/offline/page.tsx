import { OfflineDownloadList } from "@/components/reader/offline/download-list";
import { OfflineUpdate } from "@/components/shared/offline-update";
export const metadata = { title: "Downloaded books" };
// The page policy uses a request nonce (SLN-1240); Next must render matching bootstrap scripts.
export const dynamic = "force-dynamic";
export default function DownloadedBooksPage() {
  return (
    <>
      <OfflineUpdate offer={false} />
      <OfflineDownloadList />
    </>
  );
}
