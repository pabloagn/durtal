import type {
  DurtalLocator,
  ReaderEngine,
  ResolveResult,
} from "@/lib/reader/engine";
import type { ContinueDescriptor } from "./continue-target";

/** The reader needs provenance and target identity, without serializing file metadata. */
export type ContinueResumeInput = Pick<ContinueDescriptor, "anchor"> & {
  target: Pick<ContinueDescriptor["target"], "id" | "sha256">;
};

export interface ContinueLanding {
  status: Exclude<ResolveResult["status"], "failed">;
  locator: DurtalLocator;
  percent: number;
  /** Projection is not new reading activity; save with the original logical clock. */
  clientUpdatedAt: string | Date;
  sourceFileId: string;
  sourceHash: string;
  targetFileId: string;
}

function validLanding(
  locator: DurtalLocator | null,
  targetHash: string,
): locator is DurtalLocator {
  return (
    !!locator &&
    locator.v === 1 &&
    locator.fileHash === targetHash &&
    Number.isFinite(locator.totalProgression) &&
    locator.totalProgression >= 0 &&
    locator.totalProgression <= 1
  );
}

/**
 * Uses the actual reader contract after eligible target bytes are opened. The
 * source locator is never rewritten to impersonate the target before resolve.
 * Shared by historical opening and the existing remote-offer Go there handler.
 */
export async function resolveContinueAnchor(
  descriptor: ContinueResumeInput,
  engine: Pick<ReaderEngine, "resolve" | "goTo" | "currentLocator">,
): Promise<ContinueLanding | null> {
  const anchor = descriptor.anchor;
  if (!anchor) return null;
  const initial = engine.currentLocator();
  if (initial && initial.fileHash !== descriptor.target.sha256)
    throw new Error(
      "The reader opened a different file; reload to resume your saved place.",
    );
  let resolved: ResolveResult;
  try {
    resolved = await engine.resolve(anchor.locator);
  } catch {
    resolved = { status: "failed", locator: null };
  }
  let status: ContinueLanding["status"];
  if (
    resolved.status !== "failed" &&
    validLanding(resolved.locator, descriptor.target.sha256)
  ) {
    await engine.goTo(resolved.locator);
    status = resolved.status;
  } else {
    // Failure to heal a quote must not silently turn a valid saved 44% into 0%.
    await engine.goTo({ fraction: anchor.locator.totalProgression });
    status = "approximate";
  }
  const locator = engine.currentLocator();
  if (
    !validLanding(locator, descriptor.target.sha256) ||
    (status === "approximate" &&
      anchor.locator.totalProgression > 0 &&
      locator.totalProgression === 0)
  )
    throw new Error(
      "Your saved place could not be resumed. Try another readable format.",
    );
  return {
    status,
    locator,
    percent: Math.round(locator.totalProgression * 10_000) / 100,
    clientUpdatedAt: anchor.clientUpdatedAt,
    sourceFileId: anchor.fileId,
    sourceHash: anchor.locator.fileHash,
    targetFileId: descriptor.target.id,
  };
}
