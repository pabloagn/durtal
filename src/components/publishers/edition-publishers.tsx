"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PublisherPicker,
  publisherLabel,
  type PublisherOption,
} from "./publisher-picker";
import {
  getEditionPublisherLinks,
  getPublisherOptions,
  setEditionPublisherLinks,
  resetEditionPublisherLinks,
} from "@/lib/actions/publishers";
export function EditionPublishers({
  editionId,
  confirmed,
  linked = [],
}: {
  editionId: string;
  confirmed: boolean;
  linked?: PublisherOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState<PublisherOption[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [pending, start] = useTransition();
  async function open() {
    try {
      const [all, current] = await Promise.all([
        getPublisherOptions(),
        getEditionPublisherLinks(editionId),
      ]);
      setOptions(all);
      setIds(current.map((x) => x.publisher.id));
      setEditing(true);
    } catch {
      toast.error("Could not load publishers");
    }
  }
  function save(reset = false) {
    start(async () => {
      try {
        if (reset) await resetEditionPublisherLinks(editionId);
        else await setEditionPublisherLinks(editionId, ids);
        setEditing(false);
        router.refresh();
        toast.success("Publisher links saved");
      } catch {
        toast.error("Could not save publisher links");
      }
    });
  }
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {linked.map((p) => (
          <Link
            key={p.id}
            href={`/publishers/${p.slug}`}
            className="text-accent-blue hover:underline"
          >
            {p.name}
          </Link>
        ))}
        <button
          type="button"
          onClick={open}
          className="text-xs text-fg-muted hover:text-fg-primary"
        >
          {linked.length ? "Edit publisher links" : "Link publisher"}
        </button>
        {confirmed && <span className="text-xs text-fg-muted">Confirmed</span>}
      </div>
      {editing && (
        <div className="max-w-md space-y-3 rounded-sm border border-glass-border p-3">
          <div className="flex flex-wrap gap-2">
            {ids.map((id) => (
              <button
                key={id}
                type="button"
                disabled={pending}
                title="Remove link"
                onClick={() => setIds(ids.filter((x) => x !== id))}
                className="border border-glass-border px-2 py-1 text-xs"
              >
                {publisherLabel(options.find((p) => p.id === id)!)} ×
              </button>
            ))}
          </div>
          <PublisherPicker
            options={options.filter((p) => !ids.includes(p.id))}
            value=""
            onChange={(id) => id && setIds([...ids, id])}
            disabled={pending}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => save()}>
              Save links
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            {confirmed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => save(true)}
              >
                Use automatic matching
              </Button>
            )}
          </div>
          <p className="text-xs text-fg-muted">
            Confirmed links stay unchanged when metadata is refreshed. Add more
            than one for co-published editions.
          </p>
        </div>
      )}
    </div>
  );
}
