"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PublisherPicker, type PublisherOption } from "./publisher-picker";
import { TARGET_STATE } from "./target-state";
import { updateOrderStatus } from "@/lib/actions/orders";
import {
  fulfilTargetWithCopy,
  createAcquisitionTarget,
  cancelAcquisitionTarget,
  type getAcquisitionTargets,
} from "@/lib/actions/publishers";

type Target = Awaited<ReturnType<typeof getAcquisitionTargets>>[number];

function editionLabel(e: {
  title: string;
  publisher: string | null;
  isbn13: string | null;
  language: string;
}) {
  return `${e.title} · ${e.publisher ?? "Unspecified publisher"} · ${e.isbn13 ?? e.language}`;
}

export function AcquisitionTargets({
  workId,
  targets,
  publishers,
  editions,
}: {
  workId: string;
  targets: Target[];
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
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add target
        </Button>
      </div>
      {targets.length === 0 && !open && (
        <p className="text-sm text-fg-muted">
          Choose a preferred publisher or an exact edition to acquire.
        </p>
      )}
      {targets.map((t) => (
        <TargetRow key={t.target.id} {...t} />
      ))}
      {open && (
        <div className="max-w-lg space-y-3 rounded-sm border border-glass-border bg-bg-secondary p-4">
          <Select
            label="Edition preference"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={[
              { value: "any", label: "Any edition" },
              { value: "publisher", label: "From a publisher" },
              { value: "edition", label: "Exact edition" },
            ]}
          />
          {kind === "publisher" && (
            <PublisherPicker
              options={publishers}
              value={publisher}
              onChange={setPublisher}
            />
          )}
          {kind === "edition" && (
            <Select
              label="Edition"
              placeholder="Choose an edition…"
              value={edition}
              onChange={(e) => setEdition(e.target.value)}
              options={editions.map((e) => ({
                value: e.id,
                label: editionLabel(e),
              }))}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={
                pending ||
                (kind === "publisher" && !publisher) ||
                (kind === "edition" && !edition)
              }
              onClick={add}
            >
              Add target
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function TargetRow({
  target,
  state,
  publisher: p,
  edition: e,
  copies,
  orders,
}: Target) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showOrders, setShowOrders] = useState(false);
  const badge = TARGET_STATE[state] ?? TARGET_STATE.wanted;
  function run(action: () => Promise<unknown>, done?: string, failed?: string) {
    start(async () => {
      try {
        await action();
        router.refresh();
        if (done) toast.success(done);
      } catch (err) {
        toast.error(
          failed ??
            (err instanceof Error ? err.message : "Could not remove target"),
        );
      }
    });
  }
  return (
    <div className="rounded-sm border border-glass-border bg-bg-secondary px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate">
          {p ? (
            <Link
              href={`/publishers/${p.slug}`}
              className="text-fg-primary transition-colors hover:text-accent-rose"
            >
              {p.name} edition
            </Link>
          ) : e ? (
            editionLabel(e)
          ) : (
            "Any edition"
          )}
        </span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {state === "wanted" && copies.length > 0 && (
          <div className="w-60">
            <Select
              aria-label="Fulfil target with owned copy"
              placeholder="Acquired? Choose your copy…"
              value=""
              disabled={pending}
              onChange={(event) => {
                const id = event.target.value;
                if (id)
                  run(
                    () => fulfilTargetWithCopy(target.id, id),
                    "Acquisition target fulfilled",
                    "This copy does not match the target",
                  );
              }}
              options={copies.map((c) => ({
                value: c.instanceId,
                label: `${c.publisher ?? c.title} · ${c.location}`,
              }))}
            />
          </div>
        )}
        {state === "wanted" && (
          <Link
            href={`/provenance?target=${target.id}`}
            className={buttonClass("secondary", "sm")}
          >
            Order
          </Link>
        )}
        {orders.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showOrders}
            onClick={() => setShowOrders(!showOrders)}
          >
            Orders ({orders.length})
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showOrders ? "rotate-180" : ""}`}
              strokeWidth={1.5}
            />
          </Button>
        )}
        {state === "wanted" && (
          <Button
            size="sm"
            variant="ghost"
            className="w-7 px-0"
            title="Remove target"
            aria-label="Remove target"
            disabled={pending}
            onClick={() => run(() => cancelAcquisitionTarget(target.id))}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {showOrders && (
        <div className="mt-3 space-y-1 border-t border-glass-border pt-2">
          {orders.map((o) => (
            <div
              key={o.id}
              className="flex h-7 items-center justify-between gap-3 text-xs text-fg-secondary"
            >
              <span>
                <span className="font-mono">{o.date}</span> ·{" "}
                {o.status.replaceAll("_", " ")}
              </span>
              {["delivered", "received", "purchased"].includes(o.status) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => updateOrderStatus(o.id, "returned"),
                      "Return recorded",
                      "Could not record return",
                    )
                  }
                >
                  Record return
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
