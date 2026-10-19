"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { getTaxonomyEditorChoices } from "@/lib/actions/taxonomy-browse";
import { EditItemDialog, type EditableItem } from "@/components/taxonomy/edit-item-dialog";
import type { ParentChoice } from "@/components/taxonomy/parent-picker";

/** The term page's Edit: name, colour, description and parent (SLN-1158) */
export function TermActions({
  item,
  family,
}: {
  item: EditableItem & { slug: string | null };
  family: { slug: string; name: string; hierarchical: boolean; describable: boolean };
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<ParentChoice[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    try {
      setChoices(family.hierarchical ? await getTaxonomyEditorChoices(family.slug) : []);
    } catch {
      toast.error("Could not load the family’s items. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" busy={loading} onClick={() => void open()}>
        <Pencil className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
        Edit
      </Button>
      {choices && (
        <EditItemDialog
          mode="edit"
          item={item}
          familySlug={family.slug}
          familyName={family.name}
          hierarchical={family.hierarchical}
          describable={family.describable}
          choices={choices}
          onClose={() => setChoices(null)}
          onSaved={() => {
            setChoices(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
