"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePublisher } from "@/lib/actions/publishers";
import type { PublisherInput } from "@/lib/validations/publishers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelectSection } from "@/components/shared/multi-select-section";
import { PublisherPicker, type PublisherOption } from "./publisher-picker";

const KIND_OPTIONS = [
  { value: "publisher", label: "Publishing house" },
  { value: "imprint", label: "Imprint" },
];

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 font-serif text-lg text-fg-secondary">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

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
    <form
      onSubmit={submit}
      className="max-w-2xl rounded-sm border border-glass-border bg-bg-secondary p-6"
    >
      <fieldset disabled={pending} className="space-y-6">
        <FormSection title="Identity">
          <Input
            label="Name"
            name="name"
            defaultValue={publisher?.name ?? ""}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Type"
              options={KIND_OPTIONS}
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "publisher" | "imprint")
              }
            />
            <Input
              label="Country"
              name="country"
              defaultValue={publisher?.country ?? ""}
            />
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
          <Input
            label="Website"
            name="website"
            type="url"
            placeholder="https://"
            defaultValue={publisher?.website ?? ""}
          />
        </FormSection>
        <FormSection title="Description">
          <Textarea
            label="About"
            name="description"
            rows={4}
            defaultValue={publisher?.description ?? ""}
          />
          <Textarea
            label="My notes"
            name="notes"
            rows={3}
            defaultValue={publisher?.notes ?? ""}
          />
        </FormSection>
        <FormSection title="Matching">
          <Textarea
            label="Alternative names (one per line)"
            name="aliases"
            rows={3}
            defaultValue={publisher?.aliases?.join("\n") ?? ""}
          />
          <p className="text-xs text-fg-muted">
            Alternative names help match imported editions. Shared or ambiguous
            names stay unresolved for review.
          </p>
        </FormSection>
        <FormSection title="Classification">
          <MultiSelectSection
            title="Specialties"
            items={specialties}
            selectedIds={chosen}
            onChange={setChosen}
          />
        </FormSection>
        <div className="flex justify-end gap-2 border-t border-glass-border pt-4">
          <Button type="button" variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save publisher"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
