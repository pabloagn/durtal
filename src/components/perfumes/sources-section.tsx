"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAligned } from "@/components/shared/cap-aligned";
import { citeSource, deleteCitedSource } from "@/lib/actions/catalogue-provenance";

export interface SourceView {
  id: string;
  attribution: string | null;
  url: string | null;
  provider: string;
  /** "Consulted Oct 1, 2026" */
  consulted: string;
  note: string | null;
  /** The user cited it (not a provider), and nothing on the perfume cites it */
  removable: boolean;
  /** Why it cannot be removed, when it cannot */
  kept: string | null;
}

/** Today in the browser's calendar, as YYYY-MM-DD */
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Where the facts on this page come from: a website, a book, a box. A source
 * can then be cited for the dates or a formulation; a cited one stays.
 */
export function SourcesSection({
  perfumeId,
  perfumeTitle,
  sources,
}: {
  perfumeId: string;
  perfumeTitle: string;
  sources: SourceView[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <section className="mb-10" aria-labelledby="perfume-sources">
      <SectionHeading
        id="perfume-sources"
        title="Sources"
        count={sources.length || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add source
          </Button>
        }
      />
      {sources.length === 0 ? (
        <p className="text-sm text-fg-secondary">No sources recorded</p>
      ) : (
        <ul className="space-y-1.5">
          {sources.map((source) => (
            <li key={source.id} className="flex items-start gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-start gap-1.5 text-fg-primary">
                  {source.url ? (
                    <>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="transition-colors hover:text-accent-rose-text"
                      >
                        {source.attribution ?? source.provider}
                      </a>
                      <CapAligned height={12}>
                        <ExternalLink className="h-3 w-3 text-fg-muted" strokeWidth={1.5} aria-hidden />
                      </CapAligned>
                    </>
                  ) : (
                    (source.attribution ?? source.provider)
                  )}
                </p>
                <p className="text-xs text-fg-secondary">
                  {[source.url ? source.provider : null, source.consulted, source.note]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {source.removable ? (
                <CapAligned height={20}>
                  <button
                    type="button"
                    aria-label={`Remove ${source.attribution ?? "source"}`}
                    data-tooltip="Remove source"
                    disabled={removing === source.id}
                    onClick={async () => {
                      setRemoving(source.id);
                      try {
                        await deleteCitedSource(source.id);
                        toast.success("Source removed");
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not remove the source");
                      } finally {
                        setRemoving(null);
                      }
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-sm text-fg-muted transition-colors hover:text-accent-red-text"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </CapAligned>
              ) : (
                source.kept && (
                  <span className="shrink-0 text-xs leading-5 text-fg-secondary">{source.kept}</span>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add source" description={perfumeTitle} className="max-w-xl">
        {adding && (
          <SourceForm
            perfumeId={perfumeId}
            onDone={() => setAdding(false)}
          />
        )}
      </Dialog>
    </section>
  );
}

function SourceForm({ perfumeId, onDone }: { perfumeId: string; onDone: () => void }) {
  const router = useRouter();
  const [attribution, setAttribution] = useState("");
  const [url, setUrl] = useState("");
  const [day, setDay] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const validUrl = !url.trim() || /^https?:\/\/[^\s@/]+/.test(url.trim());
  const blocked = !attribution.trim() || !validUrl || !day || day > today() || saving;
  return (
    <div className="space-y-4">
      <Input
        label="Name"
        value={attribution}
        onChange={(e) => setAttribution(e.target.value)}
        placeholder="Fragrantica, the house's website, a book and page"
        maxLength={1000}
      />
      <Input
        label="Address"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https:// (none for a book or a box)"
        maxLength={4000}
        error={validUrl ? undefined : "Enter an address that starts with http:// or https://"}
      />
      <Input label="Consulted on" type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
      <Textarea
        label="What it says"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Launch year, perfumer"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-shortcut="save"
          disabled={blocked}
          onClick={async () => {
            setSaving(true);
            try {
              await citeSource({
                owner: { kind: "perfume", id: perfumeId },
                attribution: attribution.trim(),
                url: url.trim() || null,
                retrievedOn: day,
                note: note.trim() || null,
              });
              toast.success("Source added");
              onDone();
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not add the source");
              setSaving(false);
            }
          }}
        >
          Add source
        </Button>
      </div>
    </div>
  );
}
