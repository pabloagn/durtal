"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/notifications/toast";
import { PackageX, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PublisherChoice, type PublisherOption } from "./publisher-picker";
import { languageName } from "@/lib/utils/language";
import { formatDate } from "@/lib/utils/format";
import { orderStatusLabel } from "@/lib/constants/orders";
import { TARGET_STATE_LABELS } from "@/lib/catalogue/acquisition-labels";
import { updateOrderStatus } from "@/lib/actions/orders";
import { type getAcquisitionTargets } from "@/lib/actions/publishers";
import {
  fulfilTargetWithCopy,
  createAcquisitionTarget,
  cancelAcquisitionTarget,
  restoreAcquisitionTarget,
} from "@/lib/actions/catalogue-client";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";

type Target = Awaited<ReturnType<typeof getAcquisitionTargets>>[number];

/** "Penguin Classics edition", an exact edition's line, or "Any edition" */
function targetName({ publisher: p, edition: e }: Target) {
  if (p) return `${p.name} edition`;
  if (e) return `${e.title} · ${e.publisher ?? "Publisher unspecified"} · ${e.isbn13 ?? languageName(e.language)}`;
  return "Any edition";
}

export function AcquisitionTargets({
  workId,
  targets: given,
  editions,
}: {
  workId: string;
  targets: Target[];
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
  // What runs: "add", or "remove", "fulfil" or "return" with its id. Busy
  // states, not a transition: a refresh that never lands would hold one
  // pending, and every control with it
  const [busy, setBusy] = useState<string | null>(null);
  const pending = busy !== null;

  // A removed target leaves at once, and one brought back by Undo returns at
  // once, until the page's own list has caught up
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [back, setBack] = useState<Target[]>([]);
  const targets = [...given, ...back.filter((b) => !given.some((g) => g.target.id === b.target.id))]
    .filter(({ target }) => !gone.has(target.id))
    .sort((a, b) => new Date(a.target.createdAt).getTime() - new Date(b.target.createdAt).getTime());

  // After an action the page's new list sometimes never arrives on this page
  // (the action's own refresh is dropped, in all three browsers), and a later
  // refresh brings it: ask again until it comes, three times at most
  const givenRef = useRef(given);
  useEffect(() => {
    givenRef.current = given;
  });
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retry.current), []);
  function refresh() {
    const seen = givenRef.current;
    let tries = 0;
    const check = () => {
      if (givenRef.current !== seen || ++tries > 3) return;
      router.refresh();
      retry.current = setTimeout(check, 1500);
    };
    router.refresh();
    clearTimeout(retry.current);
    retry.current = setTimeout(check, 1500);
  }

  // Only the choices that can succeed: one "Any edition" target, one per edition
  const hasAny = targets.some((t) => !t.publisher && !t.edition);
  const freeEditions = editions.filter((e) => !targets.some((t) => t.edition?.id === e.id));
  const choices = [
    ...(hasAny ? [] : [{ value: "any", label: "Any edition" }]),
    { value: "publisher", label: "From a publisher" },
    ...(freeEditions.length ? [{ value: "edition", label: "Exact edition" }] : []),
  ];
  const chosen = choices.some((c) => c.value === kind) ? kind : choices[0].value;

  // After Add target, the focus goes to the new target once it shows
  const section = useRef<HTMLElement>(null);
  const added = useRef<string | null>(null);
  useEffect(() => {
    if (!added.current) return;
    const row = section.current?.querySelector<HTMLElement>(`[data-target-id="${added.current}"]`);
    if (!row) return;
    added.current = null;
    const control = row.querySelector<HTMLElement>('button[aria-label^="Remove target"]');
    if (control) control.focus();
    else {
      row.tabIndex = -1;
      row.focus();
    }
  });

  async function add() {
    if (pending) return;
    setBusy("add");
    try {
      const row = await createAcquisitionTarget({
        workId,
        publisherId: chosen === "publisher" ? (publisher?.id ?? null) : null,
        editionId: chosen === "edition" ? edition : null,
      });
      added.current = row.id;
      setOpen(false);
      setPublisher(null);
      setEdition("");
      refresh();
      toast.success("Added to acquisition targets");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add target");
    } finally {
      setBusy(null);
    }
  }
  async function remove(t: Target) {
    if (pending) return;
    setBusy(`remove:${t.target.id}`);
    try {
      await cancelAcquisitionTarget(t.target.id);
      setGone((before) => new Set(before).add(t.target.id));
      setBack((before) => before.filter((b) => b.target.id !== t.target.id));
      refresh();
      toast.success(`Target removed: ${targetName(t)}`, {
        action: { label: "Undo", onClick: () => void undo(t) },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove target");
    } finally {
      setBusy(null);
    }
  }
  async function undo(t: Target) {
    try {
      await restoreAcquisitionTarget(t.target.id);
      setGone((before) => {
        const next = new Set(before);
        next.delete(t.target.id);
        return next;
      });
      setBack((before) => [...before.filter((b) => b.target.id !== t.target.id), t]);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not bring the target back");
    }
  }
  async function run(key: string, action: () => Promise<unknown>, done: string, failed: string) {
    if (pending) return;
    setBusy(key);
    try {
      await action();
      refresh();
      toast.success(done);
    } catch {
      toast.error(failed);
    } finally {
      setBusy(null);
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
    <section ref={section} className="mb-8 space-y-3" data-focus-list="acquisition-targets">
      {unsavedPrompt}
      <SectionHeading
        title="Hunting for"
        action={
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            data-focus-empty="acquisition-targets"
          >
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
      {targets.map((t) => {
        const { target, state, publisher: p, copies, orders } = t;
        return (
          // On the first line of the edition's name, which can wrap on a
          // phone: its state, Order and Remove share that line's baseline
          <div
            key={target.id}
            data-focus-row=""
            data-target-id={target.id}
            className="flex flex-wrap items-baseline gap-3 rounded-sm border border-glass-border p-3 text-sm"
          >
            <span className="flex-1">
              {p ? (
                <Link className="text-accent-primary" href={`/publishers/${p.slug}`}>
                  {targetName(t)}
                </Link>
              ) : (
                targetName(t)
              )}
            </span>
            <span className="text-xs text-fg-secondary">
              {TARGET_STATE_LABELS[state]}
            </span>
            {state === "wanted" && (
              <Link
                className="text-xs text-accent-primary touch-hit"
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
                    void run(
                      `fulfil:${target.id}`,
                      () => fulfilTargetWithCopy(target.id, id),
                      "Acquisition target fulfilled",
                      "This copy does not match the target",
                    );
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
                      {formatDate(o.date)} · {orderStatusLabel(o.status)}
                    </span>
                    {["delivered", "received", "purchased"].includes(
                      o.status,
                    ) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        busy={busy === `return:${o.id}`}
                        aria-disabled={pending || undefined}
                        onClick={() =>
                          void run(
                            `return:${o.id}`,
                            () => updateOrderStatus(o.id, "returned"),
                            "Return recorded",
                            "Could not record return",
                          )
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
                  aria-label={`Remove target: ${targetName(t)}`}
                  // Busy, not disabled, so the focus stays on it until its
                  // row goes (FocusKeeper)
                  busy={busy === `remove:${target.id}`}
                  aria-disabled={pending || undefined}
                  onClick={() => void remove(t)}
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </CapAlignedControls>
            )}
          </div>
        );
      })}
      {open && (
        <div ref={editor} className="max-w-lg space-y-3 rounded-sm border border-glass-border p-3">
          <Select
            label="Edition preference"
            value={chosen}
            onChange={(e) => setKind(e.target.value)}
            options={choices}
          />
          {chosen === "publisher" && (
            <PublisherChoice
              value={publisher}
              onChange={setPublisher}
              allowCreate
            />
          )}{" "}
          {chosen === "edition" && (
            <Select
              label="Edition"
              value={edition}
              onChange={(e) => setEdition(e.target.value)}
              options={[
                { value: "", label: "Choose an edition…" },
                ...freeEditions.map((e) => ({
                  value: e.id,
                  label: `${e.title} · ${e.publisher ?? "Unspecified publisher"} · ${e.isbn13 ?? languageName(e.language)}`,
                })),
              ]}
            />
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              busy={busy === "add"}
              disabled={(chosen === "publisher" && !publisher) || (chosen === "edition" && !edition)}
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
