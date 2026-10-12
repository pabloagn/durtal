import { randomUUID } from "node:crypto";
import { diskPressure, sameFence, type OperationFence } from "./lifecycle";
import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import { allocationCategory, type PostgresUploadStore } from "./store";
import type { SpoolAllocationAuthority } from "./private-spool";
import type { SupervisorOwner } from "./supervisor";

/** One exclusive file attempt. Grants/tokens are in the actual operation progress. */
export class PostgresSpoolAllocationAuthority implements SpoolAllocationAuthority {
  private readonly writerToken = randomUUID();
  private grant: { fence: OperationFence; relativePath: string; bytes: number } | null = null;
  constructor(private readonly input: {
    store: PostgresUploadStore; sourceBytes: number; relativePath: string; owner: () => SupervisorOwner;
  }) {}

  private current(fence: OperationFence): SupervisorOwner {
    const owner = this.input.owner(); // owned supervisor readiness/host-lock check
    if (owner.ownerToken !== fence.ownerToken || owner.ownerFence !== fence.ownerFence) throw new Error("Allocation owner is stale");
    return owner;
  }

  async beginWriter(input: { fence: OperationFence; relativePath: string; bytes: number; availableBytes: number }): Promise<void> {
    if (this.grant) throw new Error("Allocation authority cannot be reused for another file");
    if (this.input.relativePath !== input.relativePath) throw new Error("Allocation destination changed");
    const prefix = `${input.fence.operationId}/`;
    if (!input.relativePath.startsWith(prefix)) throw new Error("Allocation path belongs to another operation");
    const key = input.relativePath.slice(prefix.length);
    allocationCategory(key, this.input.sourceBytes);
    const bytes = await this.input.store.beginWriter(this.current(input.fence), input.fence, {
      key, sourceBytes: this.input.sourceBytes, bytes: input.bytes, availableBytes: input.availableBytes, writerToken: this.writerToken,
    });
    this.grant = { fence: { ...input.fence }, relativePath: input.relativePath, bytes };
  }

  async beforeWrite(input: { fence: OperationFence; relativePath: string; allocatedGrowthBytes: number; cumulativeAllocatedBytes: number; availableBytes: number }): Promise<void> {
    this.current(input.fence);
    checkedInteger(input.allocatedGrowthBytes, "allocation growth"); checkedInteger(input.cumulativeAllocatedBytes, "cumulative allocation");
    if (!this.grant || !sameFence(this.grant.fence, input.fence) || this.grant.relativePath !== input.relativePath
      || input.cumulativeAllocatedBytes > this.grant.bytes) throw new Error("Chunk exceeds its persisted exclusive-file grant");
    if (diskPressure(undefined, input.availableBytes) || input.allocatedGrowthBytes > input.availableBytes - UPLOAD_LIMITS.freeReserveBytes)
      throw Object.assign(new Error("Upload disk reserve exhausted"), { code: "ENOSPC" });
    // No network request per 64 KiB chunk. The complete file grant was already
    // committed under the capacity-row lock; local readiness gates its spending.
  }

  async assertCurrent(fence: OperationFence): Promise<void> {
    if (!this.input.relativePath.startsWith(`${fence.operationId}/`)) throw new Error("Allocation destination belongs to another operation");
    await this.input.store.assertAllocation(this.current(fence), fence, this.input.relativePath.slice(`${fence.operationId}/`.length));
  }

  async endWriter(fence: OperationFence, relativePath: string): Promise<void> {
    if (!this.grant || !sameFence(this.grant.fence, fence) || this.grant.relativePath !== relativePath) throw new Error("Writer settlement identity differs");
    await this.input.store.endWriter(this.current(fence), fence, relativePath.slice(`${fence.operationId}/`.length), this.writerToken);
    // Keep the spent grant locally too: this attempt never reopens/reuses a path.
  }
}
