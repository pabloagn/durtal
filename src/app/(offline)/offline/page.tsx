import { OfflineDownloadList } from "@/components/reader/offline/download-list";
import { OfflineUpdate } from "@/components/shared/offline-update";
export const metadata = { title: "Offline" };
export default function OfflinePage() {
  return (
    <>
      <OfflineUpdate offer={false} />
      <OfflineDownloadList />
    </>
  );
}
