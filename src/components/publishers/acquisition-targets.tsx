"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PublisherPicker,
  fieldClass,
  type PublisherOption,
} from "./publisher-picker";
import { updateOrderStatus } from "@/lib/actions/orders";
import {
  fulfilTargetWithCopy,
  createAcquisitionTarget,
  cancelAcquisitionTarget,
  type getAcquisitionTargets,
} from "@/lib/actions/publishers";
export function AcquisitionTargets({
  workId,
  targets,
  publishers,
  editions,
}: {
  workId: string;
  targets: Awaited<ReturnType<typeof getAcquisitionTargets>>;
  publishers: PublisherOption[];
  editions: {
    id: string;
    title: string;
    publisher: string | null;
    isbn13: string | null;
    language: string;
  }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("any");
  const [publisher, setPublisher] = useState("");
  const [edition, setEdition] = useState("");
  const [pending, start] = useTransition();
  function add() {
    start(async () => {
      try {
        await createAcquisitionTarget({
          workId,
          publisherId: kind === "publisher" ? publisher : null,
          editionId: kind === "edition" ? edition : null,
        });
        setOpen(false);
        router.refresh();
        toast.success("Added to acquisition targets");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not add target",
        );
      }
    });
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl">Hunting for</h2>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          <Plus className="h-4 w-4" />
          Add target
        </Button>
      </div>
      {targets.length === 0 && !open && (
        <p className="text-sm text-fg-muted">
          Choose a preferred publisher or an exact edition to acquire.
        </p>
      )}
      {targets.map(
        ({ target, state, publisher: p, edition: e, copies, orders }) => (
          <div
            key={target.id}
            className="flex flex-wrap items-center gap-3 rounded-sm border border-glass-border p-3 text-sm"
          >
            <span className="flex-1">
              {p ? (
                <Link
                  className="text-accent-blue"
                  href={`/publishers/${p.slug}`}
                >
                  {p.name} edition
                </Link>
              ) : e ? (
                `${e.title} · ${e.publisher ?? "Publisher unspecified"} · ${e.isbn13 ?? e.language}`
              ) : (
                "Any edition"
              )}
            </span>
            <span className="text-xs text-fg-muted">
              {state.replace("_", " ")}
            </span>
            {state === "wanted" && (
              <Link
                className="text-xs text-accent-blue"
                href={`/provenance?target=${target.id}`}
              >
                Order
              </Link>
            )}
            {state === "wanted" && copies.length > 0 && (
              <select
                className={`${fieldClass} max-w-xs`}
                aria-label="Fulfil target with owned copy"
                value=""
                disabled={pending}
                onChange={(event) => {
                  const id = event.target.value;
                  if (id)
                    start(async () => {
                      try {
                        await fulfilTargetWithCopy(target.id, id);
                        router.refresh();
                        toast.success("Acquisition target fulfilled");
                      } catch {
                        toast.error("This copy does not match the target");
                      }
                    });
                }}
              >
                <option value="">Acquired? Choose your copy…</option>
                {copies.map((c) => (
                  <option key={c.instanceId} value={c.instanceId}>
                    {c.publisher ?? c.title} · {c.location}
                  </option>
                ))}
              </select>
            )}
            {orders.length > 0 && (
              <details className="w-full text-xs text-fg-secondary">
                <summary>Orders ({orders.length})</summary>
                {orders.map((o) => (
                  <div key={o.id} className="mt-2 flex items-center gap-3">
                    <span>
                      {o.date} · {o.status.replaceAll("_", " ")}
                    </span>
                    {["delivered", "received", "purchased"].includes(
                      o.status,
                    ) && (
                      <button
                        className="text-accent-blue"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            try {
                              await updateOrderStatus(o.id, "returned");
                              router.refresh();
                              toast.success("Return recorded");
                            } catch {
                              toast.error("Could not record return");
                            }
                          })
                        }
                      >
                        Record return
                      </button>
                    )}
                  </div>
                ))}
              </details>
            )}
            {state === "wanted" && (
              <button
                title="Remove target"
                aria-label="Remove target"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      await cancelAcquisitionTarget(target.id);
                      router.refresh();
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : "Could not remove target",
                      );
                    }
                  })
                }
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ),
      )}
      {open && (
        <div className="max-w-lg space-y-3 rounded-sm border border-glass-border p-3">
          <label className="block space-y-1 text-xs text-fg-secondary">
            <span>Edition preference</span>
            <select
              className={fieldClass}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="any">Any edition</option>
              <option value="publisher">From a publisher</option>
              <option value="edition">Exact edition</option>
            </select>
          </label>
          {kind === "publisher" && (
            <PublisherPicker
              options={publishers}
              value={publisher}
              onChange={setPublisher}
            />
          )}{" "}
          {kind === "edition" && (
            <label className="block text-xs text-fg-secondary">
              Edition
              <select
                className={fieldClass}
                value={edition}
                onChange={(e) => setEdition(e.target.value)}
              >
                <option value="">Choose an edition…</option>
                {editions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} · {e.publisher ?? "Unspecified publisher"} ·{" "}
                    {e.isbn13 ?? e.language}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                pending ||
                (kind === "publisher" && !publisher) ||
                (kind === "edition" && !edition)
              }
              onClick={add}
            >
              Add target
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
