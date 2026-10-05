"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PublisherChoice, type PublisherOption } from "./publisher-picker";
import { languageName } from "@/lib/utils/language";
import { updateOrderStatus } from "@/lib/actions/orders";
import {
  fulfilTargetWithCopy,
  createAcquisitionTarget,
  cancelAcquisitionTarget,
  type getAcquisitionTargets,
} from "@/lib/actions/publishers";
import { SectionHeading } from "@/components/shared/section-heading";
export function AcquisitionTargets({
  workId,
  targets,
  editions,
}: {
  workId: string;
  targets: Awaited<ReturnType<typeof getAcquisitionTargets>>;
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
  const [publisher, setPublisher] = useState<PublisherOption | null>(null);
  const [edition, setEdition] = useState("");
  const [pending, start] = useTransition();
  function add() {
    start(async () => {
      try {
        await createAcquisitionTarget({
          workId,
          publisherId: kind === "publisher" ? (publisher?.id ?? null) : null,
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
    <section className="mb-8 space-y-3">
      <SectionHeading
        title="Hunting for"
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            <Plus className="h-4 w-4" />
            Add target
          </Button>
        }
      />
      {targets.length === 0 && !open && (
        <p className="text-sm text-fg-secondary">
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
                `${e.title} · ${e.publisher ?? "Publisher unspecified"} · ${e.isbn13 ?? languageName(e.language)}`
              ) : (
                "Any edition"
              )}
            </span>
            <span className="text-xs text-fg-secondary">
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
              <Select
                className="max-w-xs"
                ariaLabel="Fulfil target with owned copy"
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
                options={[
                  { value: "", label: "Acquired? Choose your copy…" },
                  ...copies.map((c) => ({
                    value: c.instanceId,
                    label: `${c.publisher ?? c.title} · ${c.location}`,
                  })),
                ]}
              />
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
                      <Button
                        variant="ghost"
                        size="sm"
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
                      </Button>
                    )}
                  </div>
                ))}
              </details>
            )}
            {state === "wanted" && (
              <Button
                variant="ghost"
                size="sm"
                className="w-7 px-0"
                data-tooltip="Remove target"
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
                <X className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            )}
          </div>
        ),
      )}
      {open && (
        <div className="max-w-lg space-y-3 rounded-sm border border-glass-border p-3">
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
            <PublisherChoice
              value={publisher}
              onChange={setPublisher}
              allowCreate
            />
          )}{" "}
          {kind === "edition" && (
            <Select
              label="Edition"
              value={edition}
              onChange={(e) => setEdition(e.target.value)}
              options={[
                { value: "", label: "Choose an edition…" },
                ...editions.map((e) => ({
                  value: e.id,
                  label: `${e.title} · ${e.publisher ?? "Unspecified publisher"} · ${e.isbn13 ?? languageName(e.language)}`,
                })),
              ]}
            />
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
