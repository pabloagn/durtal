import {
  fixedCanvasLimits,
  rasterPlan,
  type CanvasBudgetInput,
  type RasterPlan,
} from "./canvas-budget";

interface CanvasBacking {
  width: number;
  height: number;
}
interface CancellablePaint {
  cancel(): void;
}

export interface CanvasLease {
  readonly plan: RasterPlan;
  readonly active: boolean;
  /** Reserve first, then allocate; repeated allocation is forbidden. */
  allocate<T extends CanvasBacking>(create: () => T): T;
  /** Own the render cancellation before awaiting its completion. */
  ownPaint(task: CancellablePaint): void;
  release(): void;
}

/** Counts pending allocations as well as visible and cached page canvases. */
export class CanvasLedger {
  #leases = new Set<CanvasLease>();
  #bytes = 0;
  #closed = false;
  #twoPages: boolean;

  constructor(twoPages = false) {
    this.#twoPages = twoPages;
  }

  get bytes() {
    return this.#bytes;
  }
  get count() {
    return this.#leases.size;
  }

  /** Changing mode cannot silently make existing reservations exceed a cap. */
  setTwoPages(twoPages: boolean) {
    if (this.count > fixedCanvasLimits(twoPages).pageCanvases)
      throw new Error("Evict a page canvas before changing spread mode");
    this.#twoPages = twoPages;
  }

  reserve(
    input: Omit<CanvasBudgetInput, "otherCanvasBytes">,
  ): CanvasLease | null {
    if (this.#closed) throw new Error("Canvas ledger is closed");
    if (this.count >= fixedCanvasLimits(this.#twoPages).pageCanvases)
      return null;
    const plan = rasterPlan({ ...input, otherCanvasBytes: this.#bytes });
    if (!plan) return null;
    Object.freeze(plan);
    let active = true;
    let allocated = false;
    let canvas: CanvasBacking | undefined;
    let paint: CancellablePaint | undefined;
    const lease: CanvasLease = {
      plan,
      get active() {
        return active;
      },
      allocate: <T extends CanvasBacking>(create: () => T): T => {
        if (!active || allocated)
          throw new Error("Canvas lease is unavailable");
        allocated = true;
        try {
          const backing = create();
          if (!active) {
            backing.width = 0;
            backing.height = 0;
            throw new Error("Canvas lease was released during allocation");
          }
          canvas = backing;
          backing.width = plan.width;
          backing.height = plan.height;
          return backing;
        } catch (error) {
          lease.release();
          throw error;
        }
      },
      ownPaint(task) {
        if (!active) {
          task.cancel();
          throw new Error("Canvas lease is unavailable");
        }
        if (paint) throw new Error("A canvas lease already owns a paint");
        paint = task;
      },
      release: () => {
        if (!active) return;
        active = false;
        // Cancellation must precede clearing an in-progress backing surface.
        try {
          paint?.cancel();
        } finally {
          try {
            if (canvas) {
              canvas.width = 0;
              canvas.height = 0;
            }
          } finally {
            canvas = undefined;
            paint = undefined;
            this.#leases.delete(lease);
            this.#bytes -= plan.bytes;
          }
        }
      },
    };
    this.#bytes += plan.bytes;
    this.#leases.add(lease);
    return lease;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    // One faulty cancellation must not leave the other reservations alive.
    const errors: unknown[] = [];
    for (const lease of [...this.#leases]) {
      try {
        lease.release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Canvas cleanup failed");
  }
}
