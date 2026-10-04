"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  PublisherChip,
  PublisherSearch,
  type PublisherOption,
} from "./publisher-picker";
import {
  getUnmatchedEditionNames,
  setEditionPublisherLinks,
  resetEditionPublisherLinks,
} from "@/lib/actions/publishers";

function editionsText(n: number) {
  return `${n} other edition${n === 1 ? "" : "s"}`;
}

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
  const [chosen, setChosen] = useState<PublisherOption[]>([]);
  // Publisher/imprint text of this edition that no house or alias matches
  const [names, setNames] = useState<{ name: string; others: number }[]>([]);
  const [aliasNames, setAliasNames] = useState<string[]>([]);
  const [pending, start] = useTransition();
  async function open() {
    try {
      const unmatched = await getUnmatchedEditionNames(editionId);
      setChosen(linked);
      setNames(unmatched);
      setAliasNames(unmatched.map((n) => n.name));
      setEditing(true);
    } catch {
      toast.error("Could not load publishers");
    }
  }
  // A name becomes an alias of exactly one house
  const aliasTarget = chosen.length === 1 ? chosen[0] : null;
  function save(reset = false) {
    start(async () => {
      try {
        if (reset) {
          await resetEditionPublisherLinks(editionId);
          toast.success("Publisher links saved");
        } else {
          const { linkedElsewhere } = await setEditionPublisherLinks(
            editionId,
            chosen.map((p) => p.id),
            aliasTarget ? aliasNames : [],
          );
          toast.success(
            linkedElsewhere
              ? `Saved · ${linkedElsewhere} more edition${linkedElsewhere === 1 ? "" : "s"} linked`
              : "Publisher links saved",
          );
        }
        setEditing(false);
        router.refresh();
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
        <Button type="button" variant="ghost" size="sm" onClick={open}>
          {linked.length ? "Edit publisher links" : "Link publisher"}
        </Button>
        {confirmed && <span className="text-xs text-fg-secondary">Confirmed</span>}
      </div>
      {editing && (
        <div className="max-w-md space-y-3 rounded-sm border border-glass-border p-3">
          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chosen.map((p) => (
                <PublisherChip
                  key={p.id}
                  publisher={p}
                  disabled={pending}
                  onRemove={() =>
                    setChosen(chosen.filter((x) => x.id !== p.id))
                  }
                />
              ))}
            </div>
          )}
          <PublisherSearch
            label={chosen.length ? "Add another publisher" : "Publisher"}
            exclude={chosen.map((p) => p.id)}
            allowCreate
            autoFocus
            disabled={pending}
            onSelect={(p) => setChosen([...chosen, p])}
          />
          {aliasTarget &&
            names.map((n) => (
              <label
                key={n.name}
                className="flex gap-2 text-xs leading-5 text-fg-secondary"
              >
                <CapAligned height={13}>
                  <input
                    type="checkbox"
                    className="m-0 block h-[13px] w-[13px]"
                    disabled={pending}
                    checked={aliasNames.includes(n.name)}
                    onChange={(e) =>
                      setAliasNames(
                        e.target.checked
                          ? [...aliasNames, n.name]
                          : aliasNames.filter((x) => x !== n.name),
                      )
                    }
                  />
                </CapAligned>
                <span>
                  Save &ldquo;{n.name}&rdquo; as another name of{" "}
                  {aliasTarget.name}.{" "}
                  {n.others
                    ? `${editionsText(n.others)} with this name link too.`
                    : "Future books with this name link too."}
                </span>
              </label>
            ))}
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
          <p className="text-xs text-fg-secondary">
            Confirmed links stay unchanged when metadata is refreshed. Add more
            than one for co-published editions.
          </p>
        </div>
      )}
    </div>
  );
}
