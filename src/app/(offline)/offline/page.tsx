import { OfflineDownloadList } from "@/components/reader/offline/download-list";
export const metadata = { title: "Offline" };
// The page policy uses a request nonce (SLN-1240); Next must render matching bootstrap scripts.
export const dynamic = "force-dynamic";
export default function OfflinePage() { return <OfflineDownloadList />; }
