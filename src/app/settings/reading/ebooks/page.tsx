import { previewReaderHistory, readerHistoryOperations } from "@/lib/actions/reader-history";
import { ReaderHistoryRecovery } from "./reader-history-recovery";

export const dynamic = "force-dynamic";

export const metadata = { title: "Recover eBook reading history" };

export default async function ReaderHistoryPage() {
  const [rows, operations] = await Promise.all([previewReaderHistory(), readerHistoryOperations()]);
  return <ReaderHistoryRecovery rows={rows} operations={operations} />;
}
