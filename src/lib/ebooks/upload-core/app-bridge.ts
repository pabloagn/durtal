import "server-only";
import { serverEnv } from "@/lib/env";
import { immutableMatchingWriterInput } from "../match/link";
import { installUploadBroker } from "../upload/broker";
import { UploadHostClient, type UploadBridgeConfig } from "../upload/host-bridge";
import { readPrivateConfig, uploadBridgeConfigSchema } from "../upload/service-config";
import { uploadTargetFingerprint } from "./receipts";

/** Explicit app-process setup after its reviewed host bridge configuration is
 * supplied. Uses the actual authenticated private-socket client; no local core,
 * supervisor, listener, environment fallback or byte writer starts here. */
export function installActualUploadAppBridge(config: UploadBridgeConfig): void {
  const captured = immutableMatchingWriterInput(config);
  if (captured.targetFingerprint !== uploadTargetFingerprint(serverEnv().DATABASE_URL))
    throw new Error("Upload app bridge belongs to another database");
  installUploadBroker(new UploadHostClient(captured));
}

/** The app's startup (src/instrumentation.ts) with EBOOK_UPLOAD_BRIDGE set:
 * reads the private bridge.json the upload service's init wrote, then installs
 * the client. The service may start later; until it does, uploads answer 503. */
export async function installUploadAppBridgeFromFile(file: string): Promise<void> {
  installActualUploadAppBridge(await readPrivateConfig(file, uploadBridgeConfigSchema));
}
