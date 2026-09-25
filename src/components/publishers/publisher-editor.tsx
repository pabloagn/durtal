"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePublisher } from "@/lib/actions/publishers";
import type { PublisherInput } from "@/lib/validations/publishers";
import { Button } from "@/components/ui/button";
import {
  PublisherPicker,
  fieldClass,
  type PublisherOption,
} from "./publisher-picker";
export function PublisherEditor({
  publisher,
  options,
  specialties,
}: {
  publisher?: PublisherInput & { id: string };
  options: PublisherOption[];
  specialties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState(publisher?.kind ?? "publisher");
  const [parent, setParent] = useState(publisher?.parentId ?? "");
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
            parentId: kind === "imprint" ? parent : null,
            aliases: text("aliases")
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
              onChange={(e) =>
                setKind(e.target.value as "publisher" | "imprint")
              }
            >
              <option value="publisher">Publishing house</option>
              <option value="imprint">Imprint</option>
            </select>
          </label>
        </div>
        {kind === "imprint" && (
          <PublisherPicker
            label="Parent publisher"
            options={options.filter(
              (p) => p.kind === "publisher" && p.id !== publisher?.id,
            )}
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
