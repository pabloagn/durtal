"use client";
import { PlacePicker, type PlaceValue } from "@/components/shared/place-picker";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { savePublisher } from "@/lib/actions/publishers";
import type { PublisherInput } from "@/lib/validations/publishers";
import { PARENT_KIND, type HouseKind } from "@/lib/publishers/kinds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MultiSelectSection } from "@/components/shared/multi-select-section";
import { PublisherChoice, type PublisherOption } from "./publisher-picker";

const KIND_OPTIONS = [
  { value: "group", label: "Group: owns publishers" },
  { value: "publisher", label: "Publisher: owns imprints" },
  { value: "imprint", label: "Imprint: the brand on the book" },
];
export function PublisherEditor({
  publisher,
  parent: initialParent = null,
  specialties,
}: {
  publisher?: PublisherInput & {
    id: string;
    /** The city where the house was founded */
    foundedPlace?: PlaceValue | null;
  };
  /** The current parent house of an imprint */
  parent?: PublisherOption | null;
  specialties: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<HouseKind>(publisher?.kind ?? "publisher");
  const [parent, setParent] = useState<PublisherOption | null>(initialParent);
  const [chosen, setChosen] = useState(publisher?.specialtyIds ?? []);
  const [foundedPlace, setFoundedPlace] = useState<PlaceValue | null>(
    publisher?.foundedPlace ?? null,
  );
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
            foundedYear: text("foundedYear") ? Number(text("foundedYear")) : null,
            foundedPlaceId: foundedPlace?.id ?? null,
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
          <Input
            name="name"
            label="Name"
            defaultValue={publisher?.name ?? ""}
            required
          />
          <Input
            name="country"
            label="Country"
            defaultValue={publisher?.country ?? ""}
          />
          <Input
            name="website"
            label="Website"
            type="url"
            defaultValue={publisher?.website ?? ""}
          />
          <Select
            label="Type"
            value={kind}
            options={KIND_OPTIONS}
            onChange={(e) => {
              setKind(e.target.value as HouseKind);
              // The parent's type depends on this type
              setParent(null);
            }}
          />
          <Input
            name="foundedYear"
            label="Founded (year)"
            type="number"
            inputMode="numeric"
            min={1000}
            max={2100}
            defaultValue={publisher?.foundedYear ?? ""}
          />
          {/* The shared place search, as in the author dialogs */}
          <PlacePicker
            label="Founded in (city)"
            value={foundedPlace}
            onChange={setFoundedPlace}
            disabled={pending}
          />
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
        <Textarea
          name="description"
          label="About"
          rows={3}
          defaultValue={publisher?.description ?? ""}
        />
        <Textarea
          name="notes"
          label="My notes"
          rows={3}
          defaultValue={publisher?.notes ?? ""}
        />
        <Textarea
          name="aliases"
          label="Alternative names (one per line)"
          rows={3}
          defaultValue={publisher?.aliases?.join("\n") ?? ""}
        />
        <Textarea
          name="isbnPrefixes"
          label="ISBN prefixes (one per line): books with them and no known publisher name link here"
          rows={3}
          defaultValue={publisher?.isbnPrefixes?.join("\n") ?? ""}
        />
        <MultiSelectSection
          title="Specialties"
          items={specialties}
          selectedIds={chosen}
          onChange={setChosen}
        />
        <p className="text-xs text-fg-secondary">
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
