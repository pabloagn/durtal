import { AsyncLocalStorage } from "node:async_hooks";
import type { InspectorAttemptBudget } from "../upload/inspector-resources";
import { checkedInteger, UPLOAD_LIMITS } from "../upload/limits";

const scope = new AsyncLocalStorage<InspectorAttemptBudget>();
export const inspectionBudget = () => scope.getStore();

/** Optional for the existing CLI; mandatory in the isolated browser-upload worker. */
export async function withInspectionBudget<T>(budget: InspectorAttemptBudget, task: () => Promise<T>): Promise<T> {
  return scope.run(budget, async () => {
    const result = await task();
    budget.assertHealthy(); // inspector catch-and-quarantine cannot swallow a limit breach
    return result;
  });
}

/** Conservative cumulative retention: GC/lease expiry never refunds memory. */
export function retainInspectionText(codeUnits: number): void { inspectionBudget()?.retainTextPermanent(codeUnits); }

export function chargeInspectionDecoded(entry: string, bytes: number): void { inspectionBudget()?.decodedChunk(entry, bytes); }

export function reserveDecodedText(bytes: number): void {
  if (inspectionBudget()) retainInspectionText(checkedInteger(bytes, "decoded text bytes", 0, UPLOAD_LIMITS.entryDecodedBytes));
}
