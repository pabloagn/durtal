"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  RemoveButton,
  SingleChoiceField,
  useOrganizationSearch,
} from "@/components/catalogue/record-fields";
import { linkVenueInstitution, unlinkVenueInstitution } from "@/lib/actions/venue-pages";
import type { getVenueInstitutions } from "@/lib/actions/venue-pages";
import type { OrganizationRole } from "@/lib/catalogue/organizations";
import { VENUE_TYPE_LABELS, type VenueType } from "@/lib/catalogue/venues";

type Institution = Awaited<ReturnType<typeof getVenueInstitutions>>[number];

const RELATION_LABELS = { operator: "Runs it", owner: "Owns it" } as const;
const RELATION_OPTIONS = [
  { value: "operator", label: "Runs this venue" },
  { value: "owner", label: "Owns this venue" },
];

/** The role a new institution gets, from the kind of venue it runs */
function roleFor(type: VenueType): OrganizationRole {
  return type === "museum" ? "museum" : type === "gallery" ? "gallery" : "retailer";
}

/**
 * Who runs or owns the venue: each institution with its relation and its
 * other venues (branches), and "Link an institution". A venue can have
 * several; an online shop or a bookshop may have none.
 */
export function VenueInstitutions({
  venueId,
  venueName,
  venueType,
  institutions,
}: {
  venueId: string;
  venueName: string;
  venueType: VenueType;
  institutions: Institution[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  async function unlink(institution: Institution) {
    try {
      await unlinkVenueInstitution({ organizationId: institution.id, venueId, role: institution.role });
      toast.success(`${institution.name} removed`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the institution");
    }
  }

  return (
    <section className="mb-10" aria-labelledby="venue-institutions">
      <SectionHeading
        id="venue-institutions"
        title="Institution"
        count={institutions.length || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Link an institution
          </Button>
        }
      />
      {institutions.length === 0 ? (
        <p className="text-sm text-fg-secondary">No institution recorded</p>
      ) : (
        <ul className="space-y-2">
          {institutions.map((institution) => (
            <li
              key={`${institution.id}-${institution.role}`}
              className="flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="type-item-title">{institution.name}</p>
                <p className="mt-0.5 text-sm text-fg-secondary">{RELATION_LABELS[institution.role]}</p>
                {institution.branches.length > 0 && (
                  <p className="mt-1 text-sm text-fg-secondary">
                    Also:{" "}
                    {institution.branches.map((branch, i) => (
                      <span key={branch.id}>
                        {i > 0 && ", "}
                        {branch.slug ? (
                          <Link
                            href={`/places/${branch.slug}`}
                            className="text-fg-primary transition-colors hover:text-accent-rose-text"
                          >
                            {branch.name}
                          </Link>
                        ) : (
                          branch.name
                        )}
                        {` (${VENUE_TYPE_LABELS[branch.type]}${branch.archived ? ", archived" : ""})`}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {/* Carries the name's type: the button sits on its cap-height center */}
              <div className="type-item-title">
                <RemoveButton label={`Remove ${institution.name}`} onClick={() => void unlink(institution)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding &&
        createPortal(
          <LinkInstitutionDialog
            venueId={venueId}
            venueName={venueName}
            role={roleFor(venueType)}
            onClose={() => setAdding(false)}
          />,
          document.body,
        )}
    </section>
  );
}

function LinkInstitutionDialog({
  venueId,
  venueName,
  role,
  onClose,
}: {
  venueId: string;
  venueName: string;
  role: OrganizationRole;
  onClose: () => void;
}) {
  const router = useRouter();
  const { search, create } = useOrganizationSearch(role);
  const [choice, setChoice] = useState<{ id: string; label: string } | null>(null);
  const [relation, setRelation] = useState<"operator" | "owner">("operator");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!choice) return setError("Choose an institution");
    setSaving(true);
    setError(null);
    try {
      await linkVenueInstitution({ organizationId: choice.id, venueId, role: relation });
      toast.success(`${choice.label} linked`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link the institution");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title="Link an institution"
      description={venueName}
      className="max-w-lg"
      expandable={false}
    >
      <div className="space-y-4">
        <SingleChoiceField
          label="Institution"
          value={choice}
          onChange={setChoice}
          search={search}
          onCreate={create}
          placeholder="Search organizations..."
        />
        <Select
          id="institution-relation"
          label="Relation"
          options={RELATION_OPTIONS}
          value={relation}
          onChange={(e) => setRelation(e.target.value as "operator" | "owner")}
        />
        {error && (
          <p role="alert" className="text-sm text-accent-red-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-glass-border pt-4">
          <Button size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" data-shortcut="save" disabled={saving || !choice} onClick={save}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
            Link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
