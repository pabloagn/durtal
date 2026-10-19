"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { PackageX, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PublisherChoice, type PublisherOption } from "./publisher-picker";
import { languageName } from "@/lib/utils/language";
import { updateOrderStatus } from "@/lib/actions/orders";
import { type getAcquisitionTargets } from "@/lib/actions/publishers";
import { fulfilTargetWithCopy, createAcquisitionTarget, cancelAcquisitionTarget } from "@/lib/actions/catalogue-client";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
export function AcquisitionTargets({
  workId,
  targets: given,
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
  // A removed target leaves at once. The action revalidates the page, but
  // the new list it brings is sometimes dropped on this page (seen in all
  // three browsers, with or without a refresh of its own), and the focus
  // waits for the row to go
  const [removing, setRemoving] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const targets = given.filter(({ target }) => !gone.has(target.id));
  async function remove(id: string) {
    if (pending || removing) return;
    setRemoving(id);
    try {
      await cancelAcquisitionTarget(id);
      setGone((before) => new Set(before).add(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove target");
    } finally {
      setRemoving(null);
    }
  }
  // Esc cancels the new target; with a choice made it asks first
  const editor = useRef<HTMLDivElement>(null);
  const unsavedPrompt = useEscapeToCancel({
    root: editor,
    cancel: () => setOpen(false),
    enabled: open && !pending,
    track: true,
    within: true,
  });
  return (
    <section className="mb-8 space-y-3" data-focus-list="acquisition-targets">
      {unsavedPrompt}
      <SectionHeading
        title="Hunting for"
        action={
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} data-focus-empty="acquisition-targets">
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
          // On the first line of the edition's name, which can wrap on a
          // phone: its state, Order and Remove share that line's baseline
          <div
            key={target.id}
            data-focus-row=""
            className="flex flex-wrap items-baseline gap-3 rounded-sm border border-glass-border p-3 text-sm"
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
                className="text-xs text-accent-blue touch-hit"
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
                <summary className="touch-hit">Orders ({orders.length})</summary>
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
                        <PackageX aria-hidden strokeWidth={1.5} />
                        Record return
                      </Button>
                    )}
                  </div>
                ))}
              </details>
            )}
            {state === "wanted" && (
              <CapAlignedControls height={28} coarseHeight={44}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-7 px-0"
                  data-tooltip="Remove target"
                  aria-label="Remove target"
                  // Busy, not disabled, so the focus stays on it until its
                  // row goes (FocusKeeper)
                  busy={removing === target.id}
                  aria-disabled={pending || !!removing || undefined}
                  onClick={() => remove(target.id)}
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </CapAlignedControls>
            )}
          </div>
        ),
      )}
      {open && (
        <div ref={editor} className="max-w-lg space-y-3 rounded-sm border border-glass-border p-3">
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
              data-shortcut="save"
            >
              Add target
            </Button>
            <Button data-dismiss="" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
