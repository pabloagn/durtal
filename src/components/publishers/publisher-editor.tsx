"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePublisher } from "@/lib/actions/publishers";
import type { PublisherInput } from "@/lib/validations/publishers";
import { PARENT_KIND, type HouseKind } from "@/lib/publishers/kinds";
import { Button } from "@/components/ui/button";
import {
  PublisherChoice,
  fieldClass,
  type PublisherOption,
} from "./publisher-picker";
export function PublisherEditor({
  publisher,
  parent: initialParent = null,
  specialties,
}: {
  publisher?: PublisherInput & { id: string };
  /** The current parent house of an imprint */
  parent?: PublisherOption | null;
  specialties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<HouseKind>(publisher?.kind ?? "publisher");
  const [parent, setParent] = useState<PublisherOption | null>(initialParent);
  const [chosen, setChosen] = useState(publisher?.specialtyIds ?? []);
  const [specialtySearch, setSpecialtySearch] = useState("");
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    start(async () => {
      try {
        const saved = await savePublisher(
          {
            name: text("name"),
            country: text("country") || null,
            website: text("website") || null,
            description: text("description") || null,
            notes: text("notes") || null,
            kind,
            parentId: PARENT_KIND[kind] ? (parent?.id ?? null) : null,
            aliases: text("aliases")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            isbnPrefixes: text("isbnPrefixes")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
            specialtyIds: chosen,
          },
          publisher?.id,
        );
        toast.success("Publisher saved");
        router.push(`/publishers/${saved.slug}`);
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not save publisher",
        );
      }
    });
  }
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      <fieldset disabled={pending} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ["name", "Name", publisher?.name],
            ["country", "Country", publisher?.country],
            ["website", "Website", publisher?.website],
          ].map(([name, label, value]) => (
            <label
              key={name}
              className="block space-y-1 text-sm text-fg-secondary"
            >
              <span>{label}</span>
              <input
                name={name!}
                aria-label={label!}
                className={fieldClass}
                defaultValue={value ?? ""}
                required={name === "name"}
                type={name === "website" ? "url" : "text"}
              />
            </label>
          ))}
          <label className="block space-y-1 text-sm text-fg-secondary">
            <span>Type</span>
            <select
              className={fieldClass}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as HouseKind);
                // The parent's type depends on this type
                setParent(null);
              }}
            >
              <option value="group">Group: owns publishers</option>
              <option value="publisher">Publisher: owns imprints</option>
              <option value="imprint">Imprint: the brand on the book</option>
            </select>
          </label>
        </div>
        {PARENT_KIND[kind] && (
          <PublisherChoice
            label={kind === "imprint" ? "Publisher" : "Group (optional)"}
            kinds={[PARENT_KIND[kind]!]}
            exclude={publisher ? [publisher.id] : []}
            value={parent}
            onChange={setParent}
          />
        )}
        {[
          ["description", "About", publisher?.description],
          ["notes", "My notes", publisher?.notes],
          [
            "aliases",
            "Alternative names (one per line)",
            publisher?.aliases?.join("\n"),
          ],
          [
            "isbnPrefixes",
            "ISBN prefixes (one per line): books with them and no known publisher name link here",
            publisher?.isbnPrefixes?.join("\n"),
          ],
        ].map(([name, label, value]) => (
          <label
            key={name}
            className="block space-y-1 text-sm text-fg-secondary"
          >
            <span>{label}</span>
            <textarea
              name={name!}
              aria-label={label!}
              className={fieldClass}
              rows={3}
              defaultValue={value ?? ""}
            />
          </label>
        ))}
        <div className="space-y-2">
          <label className="text-sm text-fg-secondary">
            Specialties
            <input
              className={`${fieldClass} mt-1`}
              aria-label="Search specialties"
              placeholder="Search specialties…"
              value={specialtySearch}
              onChange={(e) => setSpecialtySearch(e.target.value)}
            />
          </label>
          <div className="max-h-40 overflow-auto space-y-1">
            {specialties
              .filter(
                (s) =>
                  chosen.includes(s.id) ||
                  s.name.toLowerCase().includes(specialtySearch.toLowerCase()),
              )
              .map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 text-sm text-fg-secondary"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(s.id)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...chosen, s.id]
                          : chosen.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
          </div>
        </div>
        <p className="text-xs text-fg-muted">
          Alternative names help match imported editions. Shared or ambiguous
          names stay unresolved for review.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save publisher"}
        </Button>
      </fieldset>
    </form>
  );
}
