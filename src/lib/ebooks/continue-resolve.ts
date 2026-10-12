import type {
  BookSource,
  OpenOptions,
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

const INITIAL_CONTINUE_OPEN = Symbol("initial-continue-open");

/** A result bound to the exact request actually supplied to ReaderEngine.open. */
export interface InitialContinueOpen {
  readonly [INITIAL_CONTINUE_OPEN]: true;
  readonly anchor: ContinueResumeInput["anchor"];
  readonly targetId: string;
  readonly targetHash: string;
  readonly requested: DurtalLocator;
  readonly resolved: ResolveResult | null;
}

/** Open the requested same-file CFI first; projection/fallback keeps the existing path. */
export async function openReaderForContinue(
  descriptor: ContinueResumeInput,
  engine: Pick<ReaderEngine, "open">,
  source: BookSource,
  options: Omit<OpenOptions, "at">,
): Promise<InitialContinueOpen | undefined> {
  const anchor = descriptor.anchor;
  const locator = anchor?.locator;
  const initial = source.format === "epub" && anchor?.fileId === descriptor.target.id &&
    source.fileId === descriptor.target.id && source.sha256 === descriptor.target.sha256 &&
    validLanding(locator ?? null, descriptor.target.sha256) &&
    locator?.cfi?.startsWith("epubcfi(") && locator.cfi.endsWith(")")
    ? locator : undefined;
  const opened = await engine.open(source, initial ? { ...options, at: initial } : options);
  if (!initial) return undefined;
  return {
    [INITIAL_CONTINUE_OPEN]: true, anchor, targetId: descriptor.target.id,
    targetHash: descriptor.target.sha256, requested: initial, resolved: opened.resolved,
  };
}

/**
 * Uses the actual reader contract after eligible target bytes are opened. The
 * source locator is never rewritten to impersonate the target before resolve.
 * Shared by historical opening and the existing remote-offer Go there handler.
 */
export async function resolveContinueAnchor(
  descriptor: ContinueResumeInput,
  engine: Pick<ReaderEngine, "resolve" | "goTo" | "currentLocator">,
  initiallyOpened?: InitialContinueOpen,
): Promise<ContinueLanding | null> {
  const anchor = descriptor.anchor;
  if (!anchor) return null;
  const initial = engine.currentLocator();
  if (initial && initial.fileHash !== descriptor.target.sha256)
    throw new Error(
      "The reader opened a different file; reload to resume your saved place.",
    );
  const opened = initiallyOpened?.resolved;
  const alreadyApplied = initiallyOpened?.[INITIAL_CONTINUE_OPEN] === true &&
    initiallyOpened.anchor === anchor && initiallyOpened.requested === anchor.locator &&
    initiallyOpened.targetId === descriptor.target.id && initiallyOpened.targetHash === descriptor.target.sha256 &&
    anchor.fileId === descriptor.target.id && anchor.locator.fileHash === descriptor.target.sha256 &&
    opened?.status === "exact" && validLanding(opened.locator, descriptor.target.sha256) &&
    opened.locator.cfi === anchor.locator.cfi;
  let resolved: ResolveResult;
  if (alreadyApplied && opened) resolved = opened;
  else {
    try {
      resolved = await engine.resolve(anchor.locator);
    } catch {
      resolved = { status: "failed", locator: null };
    }
  }
  let status: ContinueLanding["status"];
  if (
    resolved.status !== "failed" &&
    validLanding(resolved.locator, descriptor.target.sha256)
  ) {
    if (!alreadyApplied) await engine.goTo(resolved.locator);
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
