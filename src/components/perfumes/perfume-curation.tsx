"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, Pencil, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CapAligned } from "@/components/shared/cap-aligned";
import { SectionHeading } from "@/components/shared/section-heading";
import { Prose } from "@/components/shared/prose";
import { updateWorkCuration } from "@/lib/actions/curation";
import type { CurationPatch } from "@/lib/catalogue/curation";

const CurationContext = createContext<{
  save: (patch: CurationPatch) => Promise<boolean>;
} | null>(null);

/**
 * Saves the perfume's favourite, rating and notes one after another. Each
 * save uses the fingerprint the previous one returned, so quick changes in a
 * row never read as someone else's edit; a reload brings the stored one.
 */
export function CurationProvider({
  workId,
  fingerprint,
  children,
}: {
  workId: string;
  fingerprint: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const latest = useRef(fingerprint);
  // Fingerprints this page replaced: a late refresh may still bring one back
  const replaced = useRef(new Set<string>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!replaced.current.has(fingerprint)) latest.current = fingerprint;
  }, [fingerprint]);
  const save = useCallback(
    (patch: CurationPatch) => {
      const run = queue.current.then(async () => {
        try {
          const saved = await updateWorkCuration({
            owner: { kind: "perfume", id: workId },
            patch,
            fingerprint: latest.current,
          });
          replaced.current.add(latest.current);
          latest.current = saved.fingerprint;
          router.refresh();
          return true;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not save");
          return false;
        }
      });
      queue.current = run;
      return run;
    },
    [router, workId],
  );
  return <CurationContext.Provider value={{ save }}>{children}</CurationContext.Provider>;
}

/** Saves one change to the perfume's personal curation; `saving` while it runs. */
function useCurationSave() {
  const context = useContext(CurationContext);
  if (!context) throw new Error("Curation controls need a CurationProvider");
  const [saving, setSaving] = useState(false);
  async function save(patch: CurationPatch) {
    setSaving(true);
    try {
      return await context!.save(patch);
    } finally {
      setSaving(false);
    }
  }
  return { save, saving };
}

/** The favourite toggle beside the title */
export function FavouriteToggle({ isFavourite }: { isFavourite: boolean }) {
  const { save, saving } = useCurationSave();
  const [on, setOn] = useState(isFavourite);
  const label = on ? "Remove from favourites" : "Add to favourites";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      data-tooltip={label}
      disabled={saving}
      onClick={async () => {
        setOn(!on);
        if (!(await save({ isFavourite: !on }))) setOn(on);
      }}
      className={`flex h-8 w-8 items-center justify-center rounded-[2px] border border-glass-border bg-bg-tertiary/50 transition-colors hover:bg-bg-tertiary ${
        on ? "text-accent-rose-text" : "text-fg-muted hover:text-fg-primary"
      }`}
    >
      <Heart className="h-4 w-4" strokeWidth={1.5} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/**
 * The personal rating, one to five stars. The row carries the text's type,
 * so each star sits on its cap-height center; choosing the current rating
 * clears it.
 */
export function RatingControl({ rating }: { rating: number | null }) {
  const { save, saving } = useCurationSave();
  const [value, setValue] = useState(rating);
  return (
    <div role="group" aria-label="Your rating" className="flex items-start">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value !== null && n <= value;
        const label = value === n ? `Clear the rating of ${n}` : `Rate ${n} of 5`;
        return (
          <CapAligned key={n} height={20}>
            <button
              type="button"
              aria-label={label}
              aria-pressed={filled}
              data-tooltip={label}
              disabled={saving}
              onClick={async () => {
                const next = value === n ? null : n;
                const previous = value;
                setValue(next);
                if (!(await save({ rating: next }))) setValue(previous);
              }}
              className={`flex h-5 w-5 items-center justify-center rounded-sm transition-colors ${
                filled ? "text-accent-gold" : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              <Star className="h-3 w-3" strokeWidth={1.5} fill={filled ? "currentColor" : "none"} />
            </button>
          </CapAligned>
        );
      })}
    </div>
  );
}

/** "Your notes": what the owner thinks of the perfume, editable in place */
export function PersonalNotes({ notes }: { notes: string | null }) {
  const { save, saving } = useCurationSave();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  return (
    <section className="mb-10" aria-labelledby="perfume-your-notes">
      <SectionHeading
        id="perfume-your-notes"
        title="Your notes"
        action={
          !editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              {notes ? "Edit" : "Write"}
            </Button>
          )
        }
      />
      {editing ? (
        <div className="max-w-2xl space-y-3" data-shortcut-scope="">
          <Textarea
            aria-label="Your notes"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={10000}
            placeholder="How it wears on you, when you reach for it"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => {
                setDraft(notes ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-shortcut="save"
              disabled={saving}
              onClick={async () => {
                if (await save({ notes: draft.trim() || null })) setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : notes ? (
        <Prose className="whitespace-pre-wrap">{notes}</Prose>
      ) : (
        <p className="text-sm text-fg-secondary">Nothing written yet</p>
      )}
    </section>
  );
}
