import "server-only";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { immutableMatchingWriterInput } from "../match/link";
import { OwnedUploadService, type OwnedUploadServiceConfig } from "../upload/owned-service";
import { ActualUploadCoreAdapter } from "./service";

/** Explicit host composition, called only by the owning host after its runtime
 * configuration is reviewed. Actual core and transport use the app database.
 * compose opens the existing private spool; start is a separate explicit call.
 */
export function composeActualUploadService(config: OwnedUploadServiceConfig, onFailure: (error: unknown) => void): Promise<OwnedUploadService> {
  const captured = immutableMatchingWriterInput(config);
  const planningUrl = serverEnv().DATABASE_URL;
  const core = new ActualUploadCoreAdapter({ database: db, planningUrl,
    volumeId: captured.volumeId, bindingSha256: captured.bridge.bindingSha256 });
  // The actual 506 composer verifies target/binding before opening the spool,
  // then binds its one supervisor to this adapter, broker and dispatcher.
  return OwnedUploadService.compose(captured, core, onFailure);
}
