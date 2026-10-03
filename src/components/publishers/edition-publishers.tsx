"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PublisherLinksField, type PublisherOption } from "./publisher-picker";
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
            className="text-fg-primary transition-colors hover:text-accent-rose"
          >
            {p.name}
          </Link>
        ))}
        {confirmed && <Badge variant="muted">Confirmed</Badge>}
        {!editing && (
          <Button size="sm" variant="ghost" onClick={open}>
            {linked.length ? "Edit publisher links" : "Link publisher"}
          </Button>
        )}
      </div>
      {editing && (
        <div className="max-w-md space-y-3 rounded-sm border border-glass-border bg-bg-primary/40 p-3">
          <PublisherLinksField
            options={options}
            ids={ids}
            onChange={setIds}
            disabled={pending}
          />
          <p className="text-xs text-fg-muted">
            Confirmed links stay unchanged when metadata is refreshed. Add more
            than one for co-published editions.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {confirmed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => save(true)}
                className="mr-auto"
              >
                Use automatic matching
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() => save()}
            >
              {pending ? "Saving…" : "Save links"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
