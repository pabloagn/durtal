/** Runs against native IndexedDB through scripts/qa/reader-offline-store.mjs. */
import {
  openOfflineStore,
  type OfflineStore,
  type DurableInput,
  type StoredOperation,
} from "@/lib/reader/offline/store";
import { isExactLocalOpeningPosition } from "@/lib/reader/opening-position";
import type { PositionSave } from "@/lib/reader/position-queue";
import {
  createReaderTransport,
  createAnnotationTransport,
} from "@/lib/reader/offline/transport";
import {
  mutationKey,
  mutationWireJson,
  validateMutation,
  type JsonObject,
} from "@/lib/reader/offline/mutations";
import {
  position,
  annotations,
  DEVICE,
  EBOOK,
  FILE,
  NOW,
  OTHER,
} from "./fixtures";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const input = (seq: number, progression = 0.5): DurableInput => ({
  mutation: position(seq, progression).mutation,
});
function deletion(seq: number, until = NOW + 10_000): DurableInput {
  const mutation = annotations(seq, { deleting: true }).mutation;
  if (mutation.kind !== "annotations") throw new Error("Expected annotation");
  return {
    mutation,
    annotation: {
      pending: { operationId: mutation.operationId },
      undo: {
        state: "undoable",
        until,
        snapshot: {
          id: mutation.body.deletes[0].id,
          ebookId: EBOOK,
          fileId: FILE,
        },
      },
    },
  };
}
const claimOptions = (
  mode: "foreground" | "lifecycle" = "foreground",
  nowMs = NOW,
  token = crypto.randomUUID(),
) => ({
  visible: true,
  reachable: true,
  currentDeviceId: DEVICE,
  nowMs,
  token,
  mode,
});
const blockReference = (row: StoredOperation) => ({
  seq: row.seq,
  operationId: row.mutation.operationId,
  revision: row.mutation.revision,
  ebookId: row.mutation.ebookId,
  fileId: row.mutation.fileId,
  deviceId: row.mutation.deviceId,
  wireJson: mutationWireJson(row.mutation),
  attempts: row.attempts,
});
export async function runOfflineStoreChecks() {
  const passed: string[] = [];
  let clock = NOW;
  let store: OfflineStore;
  let name: string;
  const open = () =>
    openOfflineStore({
      name,
      now: () => clock,
      validateAnnotations: () => true,
      channel: null,
    });
  async function check(label: string, test: () => Promise<void>) {
    name = `reader-offline-test-${crypto.randomUUID()}`;
    clock = NOW;
    store = await open();
    try {
      await test();
      passed.push(label);
    } finally {
      store.close();
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }
  await check(
    "durable commit survives connection reopen with exact originals",
    async () => {
      const original = input(1);
      await store.enqueue(original);
      store.close();
      store = await open();
      const rows = await store.inspect();
      assert(rows.length === 1, "Lost queue");
      assert(
        JSON.stringify(rows[0].mutation) === JSON.stringify(original.mutation),
        "Rewrote original",
      );
      const p = await store.readPosition(mutationKey(original.mutation));
      assert(
        p?.latest.operationId === original.mutation.operationId,
        "Lost local place",
      );
    },
  );
  // These opening decisions use the production gate and the production store
  // on native IndexedDB, including real claims/receipts rather than mock queues.
  const openingScope = { ebookId: EBOOK, fileId: FILE, deviceId: DEVICE, fileHash: "a".repeat(64) };
  async function storedReceipt(operationId: string) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction!.abort(); reject(new Error("Expected existing test database")); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ outcome: string; original: string } | undefined>((resolve, reject) => {
        const request = database.transaction("annotations", "readonly").objectStore("annotations").get(`operation:${operationId}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }
  await check("exact local opening keeps original identity across reopen, retry and exact acknowledgment", async () => {
    const original = input(1, 0.7);
    assert(original.mutation.kind === "position", "Expected position");
    original.mutation = validateMutation({
      ...original.mutation,
      body: { ...original.mutation.body,
        locator: { ...original.mutation.body.locator, cfi: "epubcfi(/6/2!/4/2/1:0)" } },
    }, { nowMs: NOW });
    assert(original.mutation.kind === "position", "Expected position");
    const serialized = JSON.stringify(original.mutation);
    await store.enqueue(original);
    store.close(); store = await open();
    const local = await store.readPosition(mutationKey(original.mutation));
    assert(local?.latest.kind === "position", "Missing reopened position");
    // Engine property order and absent optional fields are not a new save.
    const landing: PositionSave = { clientUpdatedAt: local.latest.body.clientUpdatedAt,
      chapter: local.latest.body.chapter, locator: { ...local.latest.body.locator, pageLabel: undefined }, fileId: FILE };
    const recovered = isExactLocalOpeningPosition(local.latest, landing, openingScope, true);
    if (!recovered) await store.enqueue({ mutation: { ...original.mutation, operationId: "duplicate-opening" } });
    assert(recovered, "Exact opening was incorrectly queued as new intent");
    let rows = await store.inspect();
    assert(rows.length === 1 && JSON.stringify(rows[0].mutation) === serialized, "Replaced original pending operation");
    assert(!await storedReceipt(original.mutation.operationId), "Recovery created a false coalesced/ack receipt");
    const first = await store.claim(claimOptions()); assert(first.kind === "claim", "Original claim missing");
    assert(first.references[0].operationId === original.mutation.operationId && first.json === mutationWireJson(original.mutation), "Changed original wire identity");
    // Another exact opening must not reset a live claim/lease.
    assert(isExactLocalOpeningPosition(local.latest, landing, openingScope, true), "Claimed recovery is not exact");
    rows = await store.inspect(); assert(rows[0].claim?.token === first.references[0].token, "Opening reset live lease");
    await store.settle(first.references, "retry");
    store.close(); store = await open();
    const retry = await store.claim(claimOptions("foreground", NOW, "opening-retry"));
    assert(retry.kind === "claim" && retry.references[0].operationId === original.mutation.operationId && retry.json === first.json, "Retry lost original intent");
    assert(await store.settle(first.references, "acknowledged") === 0, "Stale response removed current original retry");
    assert(await store.settle(retry.references, "acknowledged") === 1, "Exact current retry acknowledgment failed");
    assert((await store.inspect()).length === 0, "Exact acknowledged original remained queued");
    const receipt = await storedReceipt(original.mutation.operationId);
    assert(receipt?.outcome === "acknowledged" && receipt.original === serialized, "Receipt lost exact original identity/body");
  });
  for (const change of ["new-move", "different-body", "different-time", "healed"] as const) {
    await check(`opening ${change} still queues distinct intent and preserves store coalescing`, async () => {
      const original = input(1, 0.7); assert(original.mutation.kind === "position", "Expected position");
      original.mutation = validateMutation({
        ...original.mutation,
        body: { ...original.mutation.body,
          locator: { ...original.mutation.body.locator, cfi: "epubcfi(/6/2!/4/2/1:0)" } },
      }, { nowMs: NOW });
      assert(original.mutation.kind === "position", "Expected position");
      await store.enqueue(original); store.close(); store = await open();
      const local = await store.readPosition(mutationKey(original.mutation));
      assert(local?.latest.kind === "position", "Missing local position");
      const landing = JSON.parse(JSON.stringify(local.latest.body)) as PositionSave;
      if (change === "new-move") {
        landing.locator = { ...landing.locator, cfi: "epubcfi(/6/2!/4/2/1:10)", progression: 0.2, totalProgression: 0.2 };
        landing.clientUpdatedAt = new Date(NOW + 2).toISOString();
      } else if (change === "different-body") landing.chapter = "A corrected chapter label";
      else if (change === "different-time") landing.clientUpdatedAt = new Date(NOW + 2).toISOString();
      const recovered = isExactLocalOpeningPosition(local.latest, landing, openingScope, change !== "healed");
      assert(!recovered, "A changed/non-exact landing was suppressed");
      await store.enqueue({ mutation: { ...original.mutation, operationId: `opening-${change}`,
        createdAt: landing.clientUpdatedAt, body: landing } });
      const rows = await store.inspect(), next = rows.find(row => row.mutation.operationId === `opening-${change}`);
      assert(next?.state === "waiting" && next.attempts === 0 && next.claim === null &&
        JSON.stringify(next.mutation.body) === JSON.stringify(landing), "Changed landing body/state was rewritten");
      const position = await store.readPosition(mutationKey(original.mutation));
      assert(position?.latest.operationId === `opening-${change}`, "New landing did not become latest");
      if (change === "new-move") {
        assert(rows.length === 2 && position.milestone.operationId === original.mutation.operationId,
          "Backwards new move lost original furthest milestone");
        assert(!await storedReceipt(original.mutation.operationId), "Milestone incorrectly coalesced");
      } else {
        const receipt = await storedReceipt(original.mutation.operationId);
        assert(rows.length === 1 && receipt?.outcome === "coalesced" &&
          receipt.original === JSON.stringify(original.mutation), "Existing equal-progression coalescing changed");
      }
    });
  }
  await check("opening gate refuses other file/device/hash and first-open recovery", async () => {
    const original = input(1); assert(original.mutation.kind === "position", "Expected position");
    await store.enqueue(original);
    const body = original.mutation.body;
    assert(!isExactLocalOpeningPosition(null, body, openingScope, true), "First open was mistaken for recovery");
    for (const wrong of [{ ...openingScope, deviceId: OTHER }, { ...openingScope, deviceId: null },
      { ...openingScope, fileId: OTHER }, { ...openingScope, ebookId: OTHER },
      { ...openingScope, fileHash: "b".repeat(64) }])
      assert(!isExactLocalOpeningPosition(original.mutation, body, wrong, true), "Recovered another ownership scope");
    assert(!isExactLocalOpeningPosition(original.mutation, { ...body, clientUpdatedAt: undefined }, openingScope, true), "Missing opening timestamp bypassed original save");
    assert(JSON.stringify((await store.inspect())[0].mutation) === JSON.stringify(original.mutation), "Scope check mutated durable original");
  });
  await check(
    "milestone and latest persist through backwards moves and delayed enqueue",
    async () => {
      for (const [seq, value] of [
        [1, 0.2],
        [2, 0.9],
        [3, 0.3],
        [4, 0.1],
      ])
        await store.enqueue(input(seq, value));
      const delayed = input(5, 0.15);
      delayed.mutation = position(5, 0.15, {
        time: new Date(NOW + 2).toISOString(),
      }).mutation;
      await store.enqueue(delayed);
      const rows = await store.inspect();
      assert(rows.length === 2, "Unbounded positions");
      assert(
        rows[0].mutation.operationId === "position-2" &&
          rows[1].mutation.operationId === "position-4",
        "Lost original milestone/latest",
      );
      const local = await store.readPosition(mutationKey(delayed.mutation));
      assert(
        local?.milestone.operationId === "position-2" &&
          local.latest.operationId === "position-4",
        "Local facts changed",
      );
    },
  );
  await check(
    "interleaved annotations retain monotonically increasing sequence",
    async () => {
      await store.enqueue(input(1, 0.9));
      await store.enqueue({ mutation: annotations(2).mutation });
      await store.enqueue(input(3, 0.2));
      const rows = await store.inspect();
      assert(rows.map((r) => r.seq).join() === "1,2,3", "Reordered sequence");
      const claim = await store.claim(claimOptions());
      assert(
        claim.kind === "claim" && claim.rows.length === 1,
        "Skipped position head",
      );
    },
  );
  await check(
    "independent IDB connections cannot claim the same head",
    async () => {
      await store.enqueue(input(1));
      const peer = await open();
      try {
        const plans = await Promise.all([
          store.claim(claimOptions()),
          peer.claim(claimOptions()),
        ]);
        assert(
          plans.filter((p) => p.kind === "claim").length === 1,
          "Duplicate concurrent claim",
        );
        assert(
          plans.some((p) => p.kind === "stop" && p.reason === "busy"),
          "No durable ownership",
        );
      } finally {
        peer.close();
      }
    },
  );
  await check(
    "stale token/revision/body acknowledgment cannot remove current revision",
    async () => {
      await store.enqueue(input(1));
      const a = await store.claim(claimOptions());
      assert(a.kind === "claim", "No claim");
      const b = await store.claim(claimOptions("foreground", NOW + 30_000));
      assert(b.kind === "claim", "No expired reclaim");
      assert(
        (await store.settle(a.references, "acknowledged")) === 0,
        "Old token acked",
      );
      assert(
        (await store.settle(
          [{ ...b.references[0], revision: 2 }],
          "acknowledged",
        )) === 0,
        "Wrong revision acked",
      );
      assert(
        (await store.settle(
          [{ ...b.references[0], wireJson: "{}" }],
          "acknowledged",
        )) === 0,
        "Wrong body acked",
      );
      assert(
        (await store.settle(b.references, "acknowledged")) === 1,
        "Exact ack failed",
      );
      await store.enqueue(input(1));
      assert(!(await store.inspect()).length, "Acked duplicate recreated");
    },
  );
  await check(
    "authentication block survives reopen and requires exact explicit reconciliation",
    async () => {
      await store.enqueue(input(1));
      const a = await store.claim(claimOptions());
      assert(a.kind === "claim", "No claim");
      await store.settle(a.references, "blocked");
      store.close();
      store = await open();
      const blocked = (await store.inspect())[0],
        ref = blockReference(blocked);
      const next = await store.claim(claimOptions("lifecycle", NOW + 300_000));
      assert(
        next.kind === "stop" && next.reason === "blocked",
        "Auto-unblocked",
      );
      assert(!(await store.reconcile(ref, OTHER)), "Relabeled device");
      assert(
        !(await store.reconcile({ ...ref, attempts: 0 }, DEVICE)),
        "Stale reconciliation",
      );
      assert(
        await store.reconcile(ref, DEVICE),
        "Explicit reconciliation failed",
      );
      assert(
        (await store.claim(claimOptions())).kind === "claim",
        "Did not resume head",
      );
    },
  );
  await check(
    "Undo and owner snapshot commit atomically before deadline",
    async () => {
      const operation = deletion(1);
      await store.enqueue(operation);
      const pending = await store.claim(claimOptions());
      assert(
        pending.kind === "stop" && pending.reason === "undo_pending",
        "Premature effect",
      );
      const undone = await store.transactBook(EBOOK, () => ({
        annotations: [operation.annotation!.undo!.snapshot],
        cursor: null,
        pending: [],
      }));
      assert(
        !undone.pending.length && undone.annotations.length === 1,
        "Undo not atomic",
      );
      await store.enqueue(operation);
      assert(!(await store.inspect()).length, "Stale enqueue revived Undo");
    },
  );
  await check(
    "lifecycle seals delete and retry/duplicate enqueue cannot reopen Undo",
    async () => {
      const operation = deletion(1);
      await store.enqueue(operation);
      const a = await store.claim(claimOptions("lifecycle"));
      assert(a.kind === "claim", "No lifecycle claim");
      assert(
        (await store.inspect())[0].annotation?.undo?.state === "sealed",
        "Seal not durable",
      );
      await store.settle(a.references, "retry");
      await store.enqueue(deletion(1, NOW + 100_000));
      let refused = false;
      try {
        await store.transactBook(EBOOK, () => ({
          annotations: [],
          cursor: null,
          pending: [],
        }));
      } catch {
        refused = true;
      }
      assert(
        refused && (await store.inspect()).length === 1,
        "Reopened sealed Undo",
      );
    },
  );
  await check(
    "expired Undo cannot cancel and deadline-sealing preserves deferred effect bytes",
    async () => {
      const operation = deletion(1);
      await store.enqueue(operation);
      clock = NOW + 10_000;
      let refused = false;
      try {
        await store.transactBook(EBOOK, () => ({
          annotations: [],
          cursor: null,
          pending: [],
        }));
      } catch {
        refused = true;
      }
      assert(refused, "Expired Undo canceled");
      const a = await store.claim(claimOptions("foreground", clock));
      assert(a.kind === "claim", "Expired delete not claimed");
      assert(
        a.json === JSON.stringify(operation.mutation.body),
        "Changed deferred effect",
      );
    },
  );
  await check(
    "failed owner transaction aborts queue insertion and local snapshot together",
    async () => {
      const original = { mutation: annotations(1).mutation };
      await store.enqueue(original);
      let refused = false;
      try {
        await store.transactBook(EBOOK, () => ({
          annotations: [{ id: "changed" }],
          cursor: "new",
          pending: [
            original,
            { mutation: annotations(2).mutation },
            { mutation: position(3, 0.4).mutation },
          ],
        }));
      } catch {
        refused = true;
      }
      const book = await store.readBook(EBOOK);
      assert(
        refused &&
          book.pending.length === 1 &&
          !book.annotations.length &&
          book.cursor === null,
        "Partial aborted commit",
      );
    },
  );
  await check(
    "duplicate identity collision preserves prior operation and receipt",
    async () => {
      await store.enqueue(input(1));
      let refused = false;
      try {
        await store.enqueue(input(1, 0.8));
      } catch {
        refused = true;
      }
      assert(
        refused && (await store.inspect())[0].mutation.kind === "position",
        "Identity overwritten",
      );
    },
  );
  await check(
    "ignored annotation is retained visibly and exact ack/cache update are atomic",
    async () => {
      await store.enqueue({ mutation: annotations(1).mutation });
      const a = await store.claim(claimOptions());
      assert(a.kind === "claim", "No annotation claim");
      await store.settle(a.references, "acknowledged", {
        ignored: [{ seq: a.rows[0].seq, reason: "Already retired" }],
        updateBook: () => ({
          annotations: [{ id: "server" }],
          cursor: "opaque",
        }),
      });
      const book = await store.readBook(EBOOK),
        rejected = await store.readRejected();
      assert(
        !book.pending.length &&
          book.cursor === "opaque" &&
          rejected.length === 1,
        "Ignored refusal lost",
      );
    },
  );
  await check(
    "failed response reducer keeps exact claim and queue intact",
    async () => {
      await store.enqueue({ mutation: annotations(1).mutation });
      const a = await store.claim(claimOptions());
      assert(a.kind === "claim", "No claim");
      let refused = false;
      try {
        await store.settle(a.references, "acknowledged", {
          updateBook: () => {
            throw new Error("Bad response");
          },
        });
      } catch {
        refused = true;
      }
      assert(
        refused &&
          (await store.inspect())[0].claim?.token === a.references[0].token,
        "Ack committed before cache failure",
      );
    },
  );
  await check(
    "shared coordinator blocks 401 and resists all subsequent replay triggers",
    async () => {
      await store.enqueue(input(1));
      let sends = 0;
      const transport = createReaderTransport({
        store,
        now: () => clock,
        window: null,
        locks: null,
        preflight: async () => ({ authenticated: true, deviceId: DEVICE }),
        send: async () => {
          sends++;
          return { status: 401, body: null };
        },
        positionAcknowledged: () => true,
        decodeAnnotations: () => ({ outcomes: [] }),
      });
      try {
        await transport.requestReplay("foreground");
        await transport.requestReplay("lifecycle");
        clock += 300_000;
        await transport.requestReplay("foreground");
        assert(
          sends === 1 && (await store.inspect())[0].state === "blocked",
          "Repeated auth refusal request",
        );
      } finally {
        transport.destroy();
      }
    },
  );
  await check(
    "a superseded device id moves to the cookie's id and is sent (SLN-668)",
    async () => {
      await store.enqueue(input(1));
      let sends = 0;
      const devices: string[] = [];
      const transport = createReaderTransport({
        store,
        now: () => clock,
        window: null,
        locks: null,
        preflight: async () => ({ authenticated: true, deviceId: OTHER }),
        send: async (plan) => {
          sends++;
          devices.push(...plan.rows.map((row) => row.mutation.deviceId));
          return { status: 200, body: null };
        },
        positionAcknowledged: () => true,
        decodeAnnotations: () => ({ outcomes: [] }),
      });
      try {
        await transport.requestReplay("foreground");
        // The page that lost the race keeps enqueueing under its first id
        await store.enqueue(input(2, 0.6));
        await transport.requestReplay("foreground");
        assert(
          sends === 2 &&
            devices.every((device) => device === OTHER) &&
            (await store.inspect()).length === 0,
          `Superseded device not adopted: ${sends} sends, ${devices.join(",")}`,
        );
      } finally {
        transport.destroy();
      }
    },
  );
  await check(
    "malformed annotation 2xx retains original and bounds retries",
    async () => {
      await store.enqueue({ mutation: annotations(1).mutation });
      let sends = 0;
      const transport = createReaderTransport({
        store,
        now: () => clock,
        window: null,
        locks: null,
        preflight: async () => ({ authenticated: true, deviceId: DEVICE }),
        send: async () => {
          sends++;
          return { status: 200, body: {} };
        },
        positionAcknowledged: () => true,
        decodeAnnotations: () => ({ outcomes: [] }),
      });
      try {
        await transport.requestReplay("foreground");
        await transport.requestReplay("foreground");
        const head = (await store.inspect())[0];
        assert(
          sends === 1 &&
            head.state === "waiting" &&
            head.retryAt === NOW + 30_000 &&
            head.attempts === 1,
          "Blind ack or unbounded retry",
        );
      } finally {
        transport.destroy();
      }
    },
  );
  await check(
    "annotation adapter uses common queue, local transaction and subscriptions",
    async () => {
      const transport = createReaderTransport({
        store,
        window: null,
        locks: null,
        preflight: async () => {
          throw new Error("Offline");
        },
        positionAcknowledged: () => true,
        decodeAnnotations: () => ({ outcomes: [] }),
      });
      const adapter = createAnnotationTransport<
        DurableInput,
        JsonObject,
        DurableInput
      >(transport, {
        encodeOperation: (value) => value,
        encodeAnnotation: (value) => value,
        decodeAnnotation: (value) => value as JsonObject,
        decodePending: (row) => ({
          mutation: row.mutation,
          annotation: row.annotation,
        }),
        encodePending: (value) => value,
      });
      let changed = 0;
      const off = adapter.subscribe(EBOOK, () => changed++);
      try {
        await adapter.enqueue({ mutation: annotations(1).mutation });
        const book = await adapter.transactBook(EBOOK, (current) => ({
          ...current,
          annotations: [{ id: "local" }],
        }));
        assert(
          book.pending.length === 1 &&
            book.annotations.length === 1 &&
            changed === 2 &&
            (await store.inspect()).length === 1,
          "Parallel annotation queue",
        );
      } finally {
        off();
        transport.destroy();
      }
    },
  );
  await check("reopened visible online transport acknowledges an expired original delete without another event", async () => {
    const operation = deletion(1), original = JSON.stringify(operation.mutation);
    await store.enqueue(operation);
    store.close();
    clock += 11_000;
    store = await open();
    const restored = (await store.inspect())[0];
    assert(restored.annotation?.undo?.state === "undoable" && restored.attempts === 0,
      "Expected persisted expired, unattempted delete before transport restoration");
    const visibleWindow = Object.assign(new EventTarget(), {
      document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
      navigator: { onLine: true },
    });
    let sends = 0;
    const transport = createReaderTransport({
      store, window: visibleWindow as unknown as Window, locks: null, now: () => clock,
      preflight: async () => ({ authenticated: true, deviceId: DEVICE }),
      send: async (plan, _signal, mode) => {
        sends++;
        assert(mode === "foreground" && plan.rows.length === 1,
          "Restoration must use existing foreground whole-operation replay");
        assert(JSON.stringify(plan.rows[0].mutation) === original &&
          plan.json === mutationWireJson(operation.mutation), "Restoration changed original delete wire or device");
        const persisted = (await store.inspect()).find(row => row.mutation.operationId === operation.mutation.operationId);
        assert(persisted?.state === "claimed" && persisted.annotation?.undo?.state === "sealed",
          "Delete was sent before durable sealing and claiming");
        return { status: 200, body: null };
      },
      positionAcknowledged: () => true,
      decodeAnnotations: (_body, plan) => ({ outcomes: plan.rows.flatMap(row => {
        if (row.mutation.kind !== "annotations") throw new Error("Expected original delete");
        return row.mutation.body.deletes.map(item => {
          const id = item.id;
          if (typeof id !== "string") throw new Error("Expected persisted delete annotation ID");
          return { id, kind: "applied" as const };
        });
      }) }),
    });
    try {
      // Observe native IndexedDB completion; no replay call, enqueue or event
      // is supplied to the reconstructed transport by this test.
      const deadline = Date.now() + 2_000;
      while ((await store.inspect()).length && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 10));
      const receipt = await storedReceipt(operation.mutation.operationId);
      assert(sends === 1 && (await store.inspect()).length === 0 &&
        receipt?.outcome === "acknowledged" && receipt.original === original,
        "Reopened expired delete was stranded, rewritten or falsely acknowledged");
    } finally { transport.destroy(); }
  });
  await check("hide seals deletes even when device preflight fails", async () => {
    const operation = deletion(1); await store.enqueue(operation);
    const transport = createReaderTransport({ store, window: null, locks: null,
      preflight: async () => { throw new Error("Offline preflight"); },
      positionAcknowledged: () => true, decodeAnnotations: () => ({ outcomes: [] }) });
    try {
      await transport.requestReplay("lifecycle");
      const row = (await store.inspect())[0];
      assert(row.state === "waiting" && row.claim === null && row.annotation?.undo?.state === "sealed", "Failed preflight retained Undo");
      assert(JSON.stringify(row.mutation) === JSON.stringify(operation.mutation), "Rewrote original effect");
    } finally { transport.destroy(); }
  });
  await check("hide seals an oversized whole quote effect before lifecycle planning", async () => {
    const operation = deletion(1);
    if (operation.mutation.kind !== "annotations") throw new Error("Expected delete");
    operation.mutation = { ...operation.mutation, body: { ...operation.mutation.body,
      deletes: [{ ...operation.mutation.body.deletes[0], quoteEffect: { action: "delete-quote", noteId: OTHER,
        expectedNoteVersion: "界".repeat(22_000), expectedBindingVersion: "opaque" } }] } };
    await store.enqueue(operation);
    const original = JSON.stringify(operation.mutation), plan = await store.claim(claimOptions("lifecycle"));
    assert(plan.kind === "stop" && plan.reason === "lifecycle_body_too_large", "Oversized lifecycle sent");
    const row = (await store.inspect())[0];
    assert(row.annotation?.undo?.state === "sealed" && JSON.stringify(row.mutation) === original && row.claim === null,
      "Oversized effect was split, claimed or left Undo-able");
  });
  await check("hide seals deletes behind a blocked head without unblocking or claiming", async () => {
    await store.enqueue(input(1)); const claimed = await store.claim(claimOptions());
    assert(claimed.kind === "claim", "Expected position claim");
    await store.settle(claimed.references, "blocked"); await store.enqueue(deletion(2));
    await store.sealDeletes("lifecycle");
    const all = await store.inspect();
    assert(all[0].state === "blocked" && all[1].state === "waiting" && all[1].annotation?.undo?.state === "sealed",
      "Sealing changed blockers or skipped deferred intent");
  });
  await check("Retry clears a waiting head's backoff and leaves a blocked one blocked (SLN-668)", async () => {
    await store.enqueue(input(1)); const claimed = await store.claim(claimOptions());
    assert(claimed.kind === "claim", "Expected position claim");
    await store.settle(claimed.references, "retry", { retryAt: NOW + 300_000 });
    assert((await store.inspect())[0].retryAt === NOW + 300_000, "Backoff not stored");
    assert(await store.retryNow(), "Retry did not clear the backoff");
    const [head] = await store.inspect();
    assert(head.state === "waiting" && head.retryAt === null && head.attempts === 1, "Retry rewrote the head");
    assert(!(await store.retryNow()), "A head with no backoff was rewritten");
    const again = await store.claim(claimOptions());
    assert(again.kind === "claim", "Expected a claim after Retry");
    await store.settle(again.references, "blocked");
    assert(!(await store.retryNow()) && (await store.inspect())[0].state === "blocked", "Retry unblocked a head");
  });
  await check("oversized head on hide still seals a following delete", async () => {
    await store.enqueue({ mutation: annotations(1,{ note: "界".repeat(22_000) }).mutation });
    const operation = deletion(2); await store.enqueue(operation);
    const plan = await store.claim(claimOptions("lifecycle"));
    assert(plan.kind === "stop" && plan.reason === "lifecycle_body_too_large", "Oversized head was sent");
    const all = await store.inspect();
    assert(all.length === 2 && all[1].annotation?.undo?.state === "sealed" && all[1].claim === null,
      "Following delete was left Undo-able or incorrectly claimed");
    assert(JSON.stringify(all[1].mutation) === JSON.stringify(operation.mutation), "Deferred effect changed");
  });
  await check("delete retry preserves sealing and rejects a stale exact-revision response", async () => {
    await store.enqueue(deletion(1)); await store.sealDeletes("lifecycle");
    const old = await store.claim(claimOptions()); assert(old.kind === "claim", "Expected delete claim");
    await store.settle(old.references,"retry");
    const next = await store.claim(claimOptions("foreground",NOW,"new-delete")); assert(next.kind === "claim", "Expected retry claim");
    assert(await store.settle(old.references,"acknowledged") === 0, "Stale delete ack removed the retry");
    assert((await store.inspect())[0].annotation?.undo?.state === "sealed", "Retry reopened Undo");
  });
  await check("seal and cancel race has one atomic winner with no resurrection", async () => {
    const operation = deletion(1); await store.enqueue(operation);
    const outcomes = await Promise.allSettled([store.sealDeletes("lifecycle"),
      store.transactBook(EBOOK,() => ({ annotations: [operation.annotation!.undo!.snapshot], cursor: null, pending: [] }))]);
    const remaining = await store.inspect();
    assert(outcomes[0].status === "fulfilled" && outcomes[1].status === "rejected" &&
      remaining.length === 1 && remaining[0].annotation?.undo?.state === "sealed", "Cancel bypassed a committed seal");
  });
  return { passed: passed.length, skipped: 0, checks: passed };
}

/** Separate pages share this origin's real IDB and Web Lock. */
export async function prepareLockCheck(name: string, advance: boolean) {
  const store = await openOfflineStore({
    name,
    now: () => NOW + (advance ? 60_000 : 0),
    validateAnnotations: () => true,
    channel: null,
  });
  if (!advance) await store.enqueue(input(1));
  let release: (() => void) | null = null,
    sends = 0;
  const transport = createReaderTransport({
    store,
    now: () => NOW + (advance ? 60_000 : 0),
    window: null,
    locks: navigator.locks,
    preflight: async () => ({ authenticated: true, deviceId: DEVICE }),
    send: async () => {
      sends++;
      if (!advance)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { status: 200, body: { saved: true } };
    },
    positionAcknowledged: () => true,
    decodeAnnotations: () => ({ outcomes: [] }),
  });
  let flight: Promise<void> | null = null;
  return {
    start() {
      flight = transport.requestReplay("foreground");
    },
    sends: () => sends,
    async finish() {
      release?.();
      await flight;
      return { sends, queued: (await store.inspect()).length };
    },
    close() {
      transport.destroy();
      store.close();
    },
  };
}
