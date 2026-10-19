import { OfflineDownloadList } from "@/components/reader/offline/download-list";
import { OfflineUpdate } from "@/components/shared/offline-update";
export const metadata = { title: "Downloaded books" };
export default function DownloadedBooksPage() {
  return (
    <>
      <OfflineUpdate offer={false} />
      <OfflineDownloadList />
    </>
  );
}
