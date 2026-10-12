import { OfflineReader } from "@/components/reader/offline/offline-reader";
export const metadata = { title: "Read offline" };
// The reader CSP uses a request nonce; Next must render matching bootstrap scripts.
// Book data is still loaded only by OfflineReader from this device's store.
export const dynamic = "force-dynamic";
export default function OfflineReaderPage() { return <OfflineReader />; }
